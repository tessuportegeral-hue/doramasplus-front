// ============================================================
// Snippet: crédito de programa de indicação
// ============================================================
// COMO USAR:
// Cole o conteúdo da função `creditReferralIfEligible` dentro do
// webhook PIX existente (a edge function que confirma o pagamento).
// Chame-a UMA vez após você ter certeza que o pagamento foi confirmado
// e que a subscription do comprador (referred_id) já foi atualizada.
//
// Requisitos no contexto da function:
//  - Um cliente Supabase criado com SERVICE ROLE KEY (não anon).
//    Ex.:
//      import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
//      const supabase = createClient(
//        Deno.env.get("SUPABASE_URL")!,
//        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
//      );
//
// Onde chamar:
//   await creditReferralIfEligible(supabase, buyerUserId);
//
// Idempotente: se já existe linha em `referrals` com esse referred_id
// (UNIQUE), o INSERT falha silenciosamente e nada é creditado de novo.
// ============================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type CreditResult =
  | { credited: false; reason: string }
  | { credited: true; referrerId: string; daysAdded: 15 };

export async function creditReferralIfEligible(
  supabase: SupabaseClient,
  referredId: string,
): Promise<CreditResult> {
  try {
    // 1) buscar profile do comprador para descobrir o referrer
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

    // 2) anti auto-indicação (segunda barreira, além da já feita no signup)
    if (referrerId === referredId) {
      return { credited: false, reason: "self_referral" };
    }

    // 3) já existe linha em referrals para esse referred_id? (idempotência)
    const { data: existingReferral } = await supabase
      .from("referrals")
      .select("id")
      .eq("referred_id", referredId)
      .maybeSingle();
    if (existingReferral?.id) {
      return { credited: false, reason: "already_processed" };
    }

    // 4) o referred_id tem que ser conta nova:
    //    - sem registros em pix_payments (nunca pagou antes)
    //    - sem registros em subscriptions (nunca teve acesso, nem manual)
    //    OBS: se sua function já cria a row em subscriptions ANTES de chamar
    //    este snippet, mude o select abaixo para checar count = 1 ou ignore
    //    a checagem de subscriptions (mantendo só pix_payments).
    const { count: pixCount, error: pixErr } = await supabase
      .from("pix_payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", referredId);
    if (pixErr) {
      console.error("[referral] erro ao checar pix_payments:", pixErr);
      return { credited: false, reason: "pix_check_error" };
    }
    // Aceita 0 OU 1: o próprio pagamento atual pode já ter sido inserido
    // antes desta chamada. Se for >1, não é conta nova.
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
    // Mesma lógica: a sub do pagamento atual já pode ter sido criada.
    if ((subCount ?? 0) > 1) {
      return { credited: false, reason: "not_new_account_sub" };
    }

    // 5) buscar a subscription do REFERRER para somar 15 dias.
    //    Se o referrer não tem linha em subscriptions, marca como pending.
    const { data: referrerSub, error: refSubErr } = await supabase
      .from("subscriptions")
      .select("id, end_at, current_period_end")
      .eq("user_id", referrerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (refSubErr) {
      console.error("[referral] erro ao buscar sub do referrer:", refSubErr);
      return { credited: false, reason: "referrer_sub_error" };
    }

    if (!referrerSub?.id) {
      // INSERT como 'pending' (revisão manual)
      const { error: pendErr } = await supabase
        .from("referrals")
        .insert({
          referrer_id: referrerId,
          referred_id: referredId,
          status: "pending",
        });
      if (pendErr && !String(pendErr.message || "").toLowerCase().includes("duplicate")) {
        console.error("[referral] erro ao inserir pending:", pendErr);
      }
      return { credited: false, reason: "referrer_has_no_subscription" };
    }

    // 6) calcular novo end_at = max(end_at atual, now()) + 15 dias.
    //    Se end_at é passado, soma a partir de agora, senão soma ao end_at.
    const now = new Date();
    const currentEnd = referrerSub.end_at ? new Date(referrerSub.end_at) : null;
    const base =
      currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd > now
        ? currentEnd
        : now;
    const newEnd = new Date(base.getTime() + 15 * 24 * 60 * 60 * 1000);
    const newEndIso = newEnd.toISOString();

    // 7) INSERT em referrals como 'credited'. A UNIQUE constraint em
    //    referred_id garante idempotência. Se falhar por duplicate, abortamos.
    const { error: refInsErr } = await supabase
      .from("referrals")
      .insert({
        referrer_id: referrerId,
        referred_id: referredId,
        status: "credited",
        credited_at: now.toISOString(),
      });
    if (refInsErr) {
      const msg = String(refInsErr.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        return { credited: false, reason: "race_duplicate" };
      }
      console.error("[referral] erro ao inserir referral:", refInsErr);
      return { credited: false, reason: "referral_insert_error" };
    }

    // 8) UPDATE da subscription do referrer (end_at e current_period_end).
    const { error: updErr } = await supabase
      .from("subscriptions")
      .update({
        end_at: newEndIso,
        current_period_end: newEndIso,
      })
      .eq("id", referrerSub.id);

    if (updErr) {
      console.error("[referral] erro ao atualizar sub do referrer:", updErr);
      // crédito foi inserido mas a sub não somou — reverte o referral pra evitar fantasma
      await supabase
        .from("referrals")
        .delete()
        .eq("referred_id", referredId);
      return { credited: false, reason: "subscription_update_error" };
    }

    return { credited: true, referrerId, daysAdded: 15 };
  } catch (e) {
    console.error("[referral] exceção:", e);
    return { credited: false, reason: "exception" };
  }
}
