// infinitepay-reconcile (Deno runtime)
// Roda via CRON (Scheduled Trigger) e reconcilia pix_payments pendentes da InfinitePay.
// - Não depende de webhook
// - Não depende do usuário voltar pro /checkout/sucesso
// - Libera assinatura automaticamente quando payment_check retornar paid=true
// - (Opcional) Dispara Meta CAPI Purchase 1x por pagamento (pix_payments.meta_sent / meta_processing)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditReferralIfEligible, resolvePendingReferralsForReferrer } from "../_shared/referral.ts";
import { grantSubscriptionAndProfile } from "../_shared/grant-subscription.ts";

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
          : (plan === "quarterly" ? 4790 : 1690);

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

      // 2.4) libera assinatura (subscriptions primeiro, profiles só se der certo)
      const grantResult = await grantSubscriptionAndProfile(supabase, userId, {
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
        price_id: plan === "quarterly" ? "infinitepay_pix_4790" : "infinitepay_pix_1690",
        is_manual: false,
        notes: `InfinitePay (cron) - ${planName}`,
        last_renewed_at: now.toISOString(),
      });

      if (!grantResult.ok) {
        // pix_payments já ficou marcado "paid" acima, então a próxima rodada do
        // cron não vai reprocessar do zero, mas também não vamos fingir que o
        // acesso foi liberado quando não foi.
        errors.push({ order_nsu, step: "subscriptions_upsert", error: grantResult.error });
        continue;
      }
      updated++;

      // 2.5) Referral — este pagamento foi confirmado por esse cron (não pelo
      // webhook normal). Sem isso, indicações caídas nesse caminho de fallback
      // nunca creditam o indicador.
      try {
        const referralResult = await creditReferralIfEligible(supabase, userId);
        console.log("[referral] resultado (reconcile):", JSON.stringify(referralResult));
      } catch (e) {
        errors.push({ order_nsu, step: "referral_credit_exception", error: String(e) });
      }

      // 2.5b) Referral — este usuário também pode ser indicador de alguém
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
