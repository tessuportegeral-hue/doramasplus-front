import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });

type CreditResult =
  | { credited: false; reason: string }
  | { credited: true; referrerId: string; daysAdded: 15 };

// Mesma lógica usada em clever-worker (PIX) e stripe-webhook — mantenha as
// três em sincronia se o critério de elegibilidade mudar.
async function creditReferralIfEligible(referredId: string): Promise<CreditResult> {
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
    const newEndIso = newEnd.toISOString();

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
      // status:'active' também — sem isso, um referrer com assinatura já
      // vencida/cancelada ganha end_at no futuro mas o gate de acesso
      // (que exige status active/trialing/paid) continua barrando ele.
      .update({ end_at: newEndIso, current_period_end: newEndIso, status: "active" })
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

type PendingResolveResult = { resolved: number };

// Quando ESTE usuário (referrerId) acabou de ganhar/renovar uma assinatura,
// verifica se ele tem indicações que ficaram 'pending' (porque na hora em
// que o indicado pagou, ele ainda não tinha assinatura) e credita agora.
// Sem isso, uma referral 'pending' fica travada pra sempre: referred_id é
// UNIQUE em `referrals`, então nada nunca revisita essa linha.
async function resolvePendingReferralsForReferrer(
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
      .select("id, end_at, current_period_end")
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
      const newEndIso = newEnd.toISOString();

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
        .update({ end_at: newEndIso, current_period_end: newEndIso, status: "active" })
        .eq("id", referrerSub.id);

      if (updSubErr) {
        console.error("[referral] erro ao atualizar sub (resolve pending):", updSubErr);
        await supabase
          .from("referrals")
          .update({ status: "pending", credited_at: null })
          .eq("id", row.id);
        continue;
      }

      currentEnd = newEnd;
      resolved++;
    }

    return { resolved };
  } catch (e) {
    console.error("[referral] excecao em resolvePendingReferralsForReferrer:", e);
    return { resolved: 0 };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const body = await req.json().catch(() => ({}));
    const referredId = String(body?.referred_id || body?.user_id || "").trim();

    if (!referredId) {
      return json(400, { ok: false, error: "missing_referred_id" });
    }

    const result = await creditReferralIfEligible(referredId);

    // esse mesmo usuário pode ser indicador de alguém com referral 'pending'
    let pendingResult: PendingResolveResult = { resolved: 0 };
    try {
      pendingResult = await resolvePendingReferralsForReferrer(referredId);
    } catch (e) {
      console.error("[referral] excecao ao resolver pending:", e);
    }

    return json(200, { ok: true, result, pending_resolved: pendingResult.resolved });
  } catch (e) {
    console.error("[admin-credit-referral] fatal:", e);
    return json(500, { ok: false, error: "fatal" });
  }
});
