// Módulo compartilhado de programa de indicação.
// Importado por: clever-worker, stripe-webhook, admin-credit-referral,
// infinitepay-reconcile, infinitepay-verify-payment, whatsapp-sales-bot,
// asaas-webhook — qualquer função que libera uma assinatura (primeiro
// pagamento) deve chamar creditReferralIfEligible + resolvePendingReferralsForReferrer.
//
// Editar aqui corrige TODAS as funções de uma vez — antes disso, essa
// lógica existia como 6+ cópias coladas manualmente, e ficar em sincronia
// dependia de lembrar de editar todas toda vez (fácil esquecer uma).

import Stripe from "npm:stripe@14.19.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-08-16" })
  : null;

// ✅ 23/07: indicador que paga via Stripe tem cobrança controlada 100% pelo
// Stripe (cartão), não pelas colunas end_at/current_period_end daqui — só
// bater essas datas no Supabase não muda quando o Stripe cobra de verdade,
// e o customer.subscription.updated do stripe-webhook sobrescreve essas
// colunas no próximo evento, apagando o bônus. Pra funcionar de verdade,
// empurra o ciclo real no Stripe via trial_end (proration_behavior: none
// evita fatura/cobrança de proporção no meio do caminho). O stripe-webhook
// já sincroniza end_at/current_period_end quando o Stripe confirmar a
// mudança, então só usamos o retorno da própria chamada como valor
// imediato pra não esperar o round-trip do webhook.
async function pushStripeTrialEnd(
  stripeSubscriptionId: string,
  newEnd: Date,
): Promise<{ ok: true; endIso: string; status: string } | { ok: false; error: unknown }> {
  if (!stripe) {
    return { ok: false, error: "stripe_client_unavailable (STRIPE_SECRET_KEY ausente)" };
  }
  try {
    const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
      trial_end: Math.floor(newEnd.getTime() / 1000),
      proration_behavior: "none",
    });

    const rawEnd = (updated as any).current_period_end as number | null;
    const endIso = rawEnd ? new Date(rawEnd * 1000).toISOString() : newEnd.toISOString();
    return { ok: true, endIso, status: updated.status };
  } catch (e) {
    console.error("[referral] erro ao empurrar trial_end no Stripe:", e);
    return { ok: false, error: e };
  }
}

export type CreditResult =
  | { credited: false; reason: string }
  | { credited: true; referrerId: string; daysAdded: 15 };

export async function creditReferralIfEligible(
  supabase: any,
  referredId: string,
): Promise<CreditResult> {
  try {
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, referred_by")
      .eq("id", referredId)
      .maybeSingle();

    if (profileErr) {
      console.error("[referral] erro ao ler profile:", profileErr);
      return { credited: false, reason: "profile_read_error" };
    }
    if (!profile?.referred_by) {
      return { credited: false, reason: "no_referrer" };
    }

    const referrerId = profile.referred_by;
    if (referrerId === referredId) {
      return { credited: false, reason: "self_referral" };
    }

    const { data: existingReferral } = await supabase
      .from("referrals")
      .select("id")
      .eq("referred_id", referredId)
      .maybeSingle();
    if (existingReferral?.id) {
      return { credited: false, reason: "already_processed" };
    }

    // conta "nova": no máximo 1 pagamento PIX pago (evita creditar quem já
    // pagou antes por outro canal e migrou pra cá)
    const { count: pixCount, error: pixErr } = await supabase
      .from("pix_payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", referredId)
      .eq("status", "paid");
    if (pixErr) {
      console.error("[referral] erro ao checar pix_payments:", pixErr);
      return { credited: false, reason: "pix_check_error" };
    }
    if ((pixCount ?? 0) > 1) {
      return { credited: false, reason: "not_new_account_pix" };
    }

    const { count: subCount, error: subErr } = await supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", referredId);
    if (subErr) {
      console.error("[referral] erro ao checar subscriptions:", subErr);
      return { credited: false, reason: "sub_check_error" };
    }
    if ((subCount ?? 0) > 1) {
      return { credited: false, reason: "not_new_account_sub" };
    }

    const { data: referrerSub, error: refSubErr } = await supabase
      .from("subscriptions")
      .select("id, end_at, current_period_end, stripe_subscription_id")
      .eq("user_id", referrerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (refSubErr) {
      console.error("[referral] erro ao buscar sub do referrer:", refSubErr);
      return { credited: false, reason: "referrer_sub_error" };
    }

    if (!referrerSub?.id) {
      const { error: pendErr } = await supabase
        .from("referrals")
        .insert({ referrer_id: referrerId, referred_id: referredId, status: "pending" });
      if (pendErr && !String(pendErr.message || "").toLowerCase().includes("duplicate")) {
        console.error("[referral] erro ao inserir pending:", pendErr);
      }
      return { credited: false, reason: "referrer_has_no_subscription" };
    }

    const nowRef = new Date();
    const currentEnd = referrerSub.end_at ? new Date(referrerSub.end_at) : null;
    const base =
      currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd > nowRef
        ? currentEnd
        : nowRef;
    const newEnd = new Date(base.getTime() + 15 * 24 * 60 * 60 * 1000);
    let newEndIso = newEnd.toISOString();
    let newStatus = "active";

    // ✅ Referrer Stripe: empurra o ciclo de cobrança real ANTES de creditar
    // qualquer coisa. Se isso falhar, NÃO credita e NÃO mexe em subscriptions
    // — cai como "pending" pra tentar de novo na próxima vez que o referrer
    // pagar o Stripe dele (resolvePendingReferralsForReferrer roda nesse
    // gatilho). Assim ninguém fica com dias de graça sem a cobrança real
    // ter sido de fato adiada.
    if (referrerSub.stripe_subscription_id) {
      const pushResult = await pushStripeTrialEnd(referrerSub.stripe_subscription_id, newEnd);
      if (!pushResult.ok) {
        console.error(
          "[referral] push de trial_end falhou p/ referrer Stripe, guardando como pending:",
          referrerId,
          pushResult.error,
        );
        const { error: pendErr } = await supabase
          .from("referrals")
          .insert({ referrer_id: referrerId, referred_id: referredId, status: "pending" });
        if (pendErr && !String(pendErr.message || "").toLowerCase().includes("duplicate")) {
          console.error("[referral] erro ao inserir pending (stripe push falhou):", pendErr);
        }
        return { credited: false, reason: "stripe_trial_end_error" };
      }
      newEndIso = pushResult.endIso;
      newStatus = pushResult.status;
    }

    const { error: refInsErr } = await supabase
      .from("referrals")
      .insert({
        referrer_id: referrerId,
        referred_id: referredId,
        status: "credited",
        credited_at: nowRef.toISOString(),
      });
    if (refInsErr) {
      const msg = String(refInsErr.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        return { credited: false, reason: "race_duplicate" };
      }
      console.error("[referral] erro ao inserir referral:", refInsErr);
      return { credited: false, reason: "referral_insert_error" };
    }

    const { error: updErr } = await supabase
      .from("subscriptions")
      .update({ end_at: newEndIso, current_period_end: newEndIso, status: newStatus })
      .eq("id", referrerSub.id);

    if (updErr) {
      console.error("[referral] erro ao atualizar sub do referrer:", updErr);
      await supabase.from("referrals").delete().eq("referred_id", referredId);
      return { credited: false, reason: "subscription_update_error" };
    }

    return { credited: true, referrerId, daysAdded: 15 };
  } catch (e) {
    console.error("[referral] excecao:", e);
    return { credited: false, reason: "exception" };
  }
}

export type PendingResolveResult = { resolved: number };

// Quando ESTE usuário (referrerId) acabou de ganhar/renovar uma assinatura,
// verifica se ele tem indicações que ficaram 'pending' (porque na hora em
// que o indicado pagou, ele ainda não tinha assinatura, ou porque um push
// de trial_end no Stripe falhou antes) e credita agora.
// Sem isso, uma referral 'pending' fica travada pra sempre: referred_id é
// UNIQUE em `referrals`, então nada nunca revisita essa linha.
export async function resolvePendingReferralsForReferrer(
  supabase: any,
  referrerId: string,
): Promise<PendingResolveResult> {
  try {
    const { data: pendingRows, error: pendErr } = await supabase
      .from("referrals")
      .select("id, referred_id")
      .eq("referrer_id", referrerId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (pendErr) {
      console.error("[referral] erro ao buscar pending do referrer:", pendErr);
      return { resolved: 0 };
    }
    if (!pendingRows?.length) return { resolved: 0 };

    const { data: referrerSub, error: refSubErr } = await supabase
      .from("subscriptions")
      .select("id, end_at, current_period_end, stripe_subscription_id")
      .eq("user_id", referrerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (refSubErr || !referrerSub?.id) return { resolved: 0 };

    let currentEnd = referrerSub.end_at ? new Date(referrerSub.end_at) : null;
    let resolved = 0;

    for (const row of pendingRows) {
      const now = new Date();
      const base =
        currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd > now
          ? currentEnd
          : now;
      const newEnd = new Date(base.getTime() + 15 * 24 * 60 * 60 * 1000);
      let newEndIso = newEnd.toISOString();
      let newStatus = "active";

      if (referrerSub.stripe_subscription_id) {
        const pushResult = await pushStripeTrialEnd(referrerSub.stripe_subscription_id, newEnd);
        if (!pushResult.ok) {
          console.error(
            "[referral] push de trial_end falhou ao resolver pending, mantém pending:",
            row.id,
            pushResult.error,
          );
          continue; // fica pending, tenta de novo na próxima renovação do referrer
        }
        newEndIso = pushResult.endIso;
        newStatus = pushResult.status;
      }

      // guarda otimista (.eq status=pending) pra evitar corrida com outro processo
      const { data: updRefRow, error: updRefErr } = await supabase
        .from("referrals")
        .update({ status: "credited", credited_at: now.toISOString() })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (updRefErr || !updRefRow?.id) {
        if (updRefErr) console.error("[referral] erro ao promover pending->credited:", updRefErr);
        continue;
      }

      const { error: updSubErr } = await supabase
        .from("subscriptions")
        .update({ end_at: newEndIso, current_period_end: newEndIso, status: newStatus })
        .eq("id", referrerSub.id);

      if (updSubErr) {
        console.error("[referral] erro ao atualizar sub (resolve pending):", updSubErr);
        await supabase
          .from("referrals")
          .update({ status: "pending", credited_at: null })
          .eq("id", row.id);
        continue;
      }

      currentEnd = new Date(newEndIso);
      resolved++;
    }

    return { resolved };
  } catch (e) {
    console.error("[referral] excecao em resolvePendingReferralsForReferrer:", e);
    return { resolved: 0 };
  }
}
