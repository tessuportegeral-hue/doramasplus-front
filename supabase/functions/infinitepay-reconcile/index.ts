// infinitepay-reconcile (Deno runtime)
// Roda via CRON (Scheduled Trigger) e reconcilia pix_payments pendentes da InfinitePay.
// - Não depende de webhook
// - Não depende do usuário voltar pro /checkout/sucesso
// - Libera assinatura automaticamente quando payment_check retornar paid=true
// - (Opcional) Dispara Meta CAPI Purchase 1x por pagamento (pix_payments.meta_sent / meta_processing)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function maxDate(a?: Date | null, b?: Date | null) {
  if (!a && !b) return null;
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return a > b ? a : b;
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendMetaPurchase(opts: {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
  eventId: string;
  eventTimeUnix: number;
  value: number;
  currency: "BRL";
  contentName: string;
  userEmail?: string | null;
}): Promise<boolean> {
  try {
    const {
      pixelId,
      accessToken,
      testEventCode,
      eventId,
      eventTimeUnix,
      value,
      currency,
      contentName,
      userEmail,
    } = opts;

    let em: string[] | undefined = undefined;
    if (userEmail) {
      const normalized = userEmail.trim().toLowerCase();
      if (normalized) em = [await sha256Hex(normalized)];
    }

    const payload: any = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTimeUnix,
          event_id: eventId,
          action_source: "website",
          user_data: em ? { em } : {},
          custom_data: { currency, value, content_name: contentName },
        },
      ],
    };

    if (testEventCode) payload.test_event_code = testEventCode;

    const resp = await fetch(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(
        pixelId
      )}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("META CAPI ERROR:", resp.status, t);
      return false;
    }

    const j = await resp.json().catch(() => ({}));
    console.log("META CAPI OK:", j);
    return true;
  } catch (e) {
    console.error("META CAPI EXCEPTION:", e);
    return false;
  }
}

function parsePlanFromOrder(order_nsu: string): "monthly" | "quarterly" | null {
  try {
    const parts = String(order_nsu || "").split("|");
    if (parts.length >= 3) {
      const p = parts[2];
      if (p === "monthly" || p === "quarterly") return p;
    }
  } catch {}
  return null;
}

type CreditResult =
  | { credited: false; reason: string }
  | { credited: true; referrerId: string; daysAdded: 15 };

// Mesma lógica usada em clever-worker, stripe-webhook e admin-credit-referral
// — mantenha as quatro em sincronia se o critério de elegibilidade mudar.
async function creditReferralIfEligible(supabase: any, referredId: string): Promise<CreditResult> {
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
// verifica se ele tem indicações que ficaram 'pending' e credita agora.
async function resolvePendingReferralsForReferrer(
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

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // CRON normalmente chama POST, mas não vamos falhar se vier GET
  if (req.method !== "POST") {
    return json({ ok: true, ignored_method: req.method }, 200);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const infiniteHandle = Deno.env.get("INFINITEPAY_HANDLE") ?? "";

    // payment_check timeout
    const paymentCheckTimeoutMs = Number(
      Deno.env.get("INFINITEPAY_PAYMENTCHECK_TIMEOUT_MS") ?? "3500"
    );

    // ⚙️ ajustes do cron
    const lookbackHours = Number(Deno.env.get("INFINITEPAY_RECONCILE_LOOKBACK_HOURS") ?? "24");
    const batchLimit = Number(Deno.env.get("INFINITEPAY_RECONCILE_BATCH_LIMIT") ?? "30");

    // ✅ Meta CAPI (opcional)
    const metaPixelId = Deno.env.get("META_PIXEL_ID") ?? "";
    const metaAccessToken = Deno.env.get("META_ACCESS_TOKEN") ?? "";
    const metaTestEventCode = Deno.env.get("META_TEST_EVENT_CODE") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ success: false, message: "ENV Supabase ausente (URL/SERVICE_ROLE)" }, 400);
    }
    if (!infiniteHandle) {
      return json({ success: false, message: "INFINITEPAY_HANDLE ausente" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

    // 1) pega pendentes recentes
    const { data: pendings, error: pendErr } = await supabase
      .from("pix_payments")
      .select(
        "created_at, user_id, provider, plan, amount_cents, order_nsu, invoice_slug, transaction_nsu, status, paid_at, meta_sent, meta_processing, event_id"
      )
      .eq("provider", "infinitepay")
      .eq("status", "pending")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(batchLimit);

    if (pendErr) {
      console.error("Erro ao buscar pendentes:", pendErr);
      return json({ success: false, message: "Erro ao buscar pendentes", error: pendErr }, 500);
    }

    if (!pendings?.length) {
      return json({
        success: true,
        message: null,
        checked: 0,
        paid: 0,
        updated: 0,
        meta_sent: 0,
      }, 200);
    }

    let checked = 0;
    let paidCount = 0;
    let updated = 0;
    let metaSentCount = 0;
    const errors: any[] = [];

    // 2) processa um por um (mais seguro)
    for (const row of pendings) {
      checked++;

      const order_nsu = String(row?.order_nsu ?? "").trim();
      const userId = String(row?.user_id ?? "").trim();
      if (!order_nsu || !userId) continue;

      const plan =
        (row?.plan === "monthly" || row?.plan === "quarterly"
          ? row.plan
          : parsePlanFromOrder(order_nsu)) ?? "monthly";

      const invoice_slug = String(row?.invoice_slug ?? "").trim();
      const transaction_nsu = String(row?.transaction_nsu ?? "").trim();

      // 2.1) payment_check
      let paid = false;
      let checkPayload: any = null;

      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), paymentCheckTimeoutMs);

        const checkResp = await fetch(
          "https://api.infinitepay.io/invoices/public/checkout/payment_check",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              handle: infiniteHandle,
              order_nsu,
              slug: invoice_slug,
              transaction_nsu,
            }),
          }
        );

        clearTimeout(to);

        const check = await checkResp.json().catch(() => ({} as any));
        checkPayload = check;

        if (checkResp.ok && check?.success && check?.paid) paid = true;
      } catch (e) {
        errors.push({ order_nsu, step: "payment_check", error: String(e) });
        continue;
      }

      if (!paid) continue;

      paidCount++;

      // 2.2) calcula end_at acumulando (igual seu fluxo)
      const now = new Date();
      const daysToAdd = plan === "quarterly" ? 90 : 30;

      let baseDate = now;
      try {
        const { data: currentSub } = await supabase
          .from("subscriptions")
          .select("status, end_at, current_period_end")
          .eq("user_id", userId)
          .maybeSingle();

        const { data: prof } = await supabase
          .from("profiles")
          .select("active, subscription_active_until")
          .eq("id", userId)
          .maybeSingle();

        const endAtSub = currentSub?.end_at ? new Date(currentSub.end_at) : null;
        const cpe = currentSub?.current_period_end ? new Date(currentSub.current_period_end) : null;
        const endProf = prof?.subscription_active_until ? new Date(prof.subscription_active_until) : null;

        const bestEnd = maxDate(maxDate(endAtSub, cpe), endProf);

        const isActive =
          (currentSub?.status === "active" || currentSub?.status === "trialing") ||
          prof?.active === true;

        if (bestEnd && isActive && bestEnd > now) baseDate = bestEnd;
      } catch {}

      const endAt = addDays(baseDate, daysToAdd);

      const planName = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrão";
      const planInterval = plan === "quarterly" ? "quarter" : "month";
      const amountCents =
        typeof row?.amount_cents === "number"
          ? row.amount_cents
          : (plan === "quarterly" ? 4390 : 1590);

      const eventIdForMeta =
        (row?.event_id && String(row.event_id).trim()) ? String(row.event_id).trim() : order_nsu;

      // 2.3) marca pix_payments como paid (idempotente)
      try {
        await supabase.from("pix_payments").upsert(
          {
            user_id: userId,
            provider: "infinitepay",
            plan,
            amount_cents: amountCents,
            order_nsu,
            invoice_slug,
            transaction_nsu,
            status: "paid",
            paid_at: now.toISOString(),
            event_id: eventIdForMeta,
            // ⚠️ não assumo coluna extra. Se sua "raw" existir e quiser salvar check, dá pra ajustar depois.
          },
          { onConflict: "order_nsu" }
        );
      } catch (e) {
        errors.push({ order_nsu, step: "pix_payments_upsert", error: String(e) });
      }

      // 2.4) libera assinatura (subscriptions)
      try {
        const baseSubscription = {
          user_id: userId,
          status: "active",
          start_at: now.toISOString(),
          end_at: endAt.toISOString(),
          current_period_end: endAt.toISOString(),
          plan_name: planName,
          plan_interval: planInterval,
          source: "infinitepay",
          provider: "infinitepay",
          provider_ref: invoice_slug || transaction_nsu || order_nsu,
          order_nsu,
          price_id: plan === "quarterly" ? "infinitepay_pix_4390" : "infinitepay_pix_1590",
          is_manual: false,
          notes: `InfinitePay (cron) - ${planName}`,
          last_renewed_at: now.toISOString(),
        };

        const { error: subErr } = await supabase
          .from("subscriptions")
          .upsert(baseSubscription, { onConflict: "user_id" });

        if (subErr) {
          errors.push({ order_nsu, step: "subscriptions_upsert", error: subErr });
        } else {
          updated++;
        }
      } catch (e) {
        errors.push({ order_nsu, step: "subscriptions_upsert_exception", error: String(e) });
      }

      // 2.5) profiles update
      try {
        await supabase
          .from("profiles")
          .update({
            active: true,
            subscription_active_until: endAt.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", userId);
      } catch (e) {
        errors.push({ order_nsu, step: "profiles_update", error: String(e) });
      }

      // 2.5b) Referral — este pagamento foi confirmado por esse cron (não pelo
      // webhook normal). Sem isso, indicações caídas nesse caminho de fallback
      // nunca creditam o indicador.
      try {
        const referralResult = await creditReferralIfEligible(supabase, userId);
        console.log("[referral] resultado (reconcile):", JSON.stringify(referralResult));
      } catch (e) {
        errors.push({ order_nsu, step: "referral_credit_exception", error: String(e) });
      }

      // 2.5c) Referral — este usuário também pode ser indicador de alguém
      // com referral 'pending'.
      try {
        const pendingResult = await resolvePendingReferralsForReferrer(supabase, userId);
        if (pendingResult.resolved > 0) {
          console.log("[referral] pending resolvidos (reconcile):", pendingResult.resolved, "para", userId);
        }
      } catch (e) {
        errors.push({ order_nsu, step: "referral_pending_exception", error: String(e) });
      }

      // 2.6) Meta CAPI (opcional) — 1x por pagamento
      if (metaPixelId && metaAccessToken) {
        try {
          // lock por pagamento (meta_sent/meta_processing)
          const { data: lockRow } = await supabase
            .from("pix_payments")
            .update({ meta_processing: true })
            .eq("order_nsu", order_nsu)
            .eq("status", "paid")
            .eq("meta_sent", false)
            .eq("meta_processing", false)
            .select("order_nsu")
            .maybeSingle();

          if (lockRow?.order_nsu) {
            // pega email (opcional)
            let userEmail: string | null = null;
            try {
              const { data } = await supabase.auth.admin.getUserById(userId);
              userEmail = (data as any)?.user?.email ?? null;
            } catch {}

            const ok = await sendMetaPurchase({
              pixelId: metaPixelId,
              accessToken: metaAccessToken,
              testEventCode: metaTestEventCode || undefined,
              eventId: eventIdForMeta,
              eventTimeUnix: Math.floor(now.getTime() / 1000),
              value: amountCents / 100,
              currency: "BRL",
              contentName: planName,
              userEmail,
            });

            if (ok) {
              try {
                await supabase
                  .from("pix_payments")
                  .update({ meta_sent: true, meta_processing: false })
                  .eq("order_nsu", order_nsu);
                metaSentCount++;
              } catch {}
            } else {
              // solta lock pra tentar depois
              try {
                await supabase
                  .from("pix_payments")
                  .update({ meta_processing: false })
                  .eq("order_nsu", order_nsu);
              } catch {}
            }
          }
        } catch (e) {
          // nunca travar liberação por causa do pixel
          errors.push({ order_nsu, step: "meta_block", error: String(e) });
        }
      }
    }

    return json(
      {
        success: true,
        message: null,
        checked,
        paid: paidCount,
        updated,
        meta_sent: metaSentCount,
        lookback_hours: lookbackHours,
        batch_limit: batchLimit,
        errors_count: errors.length,
        errors: errors.slice(0, 10), // evita resposta gigante
      },
      200
    );
  } catch (e) {
    console.error("infinitepay-reconcile ERROR:", e);
    return json({ success: false, message: String(e) }, 500);
  }
});
