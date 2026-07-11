// infinitepay-verify-payment (Deno runtime)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

/** ✅ sha256 pra hash do email (CAPI) */
async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ✅ envia Purchase via Meta CAPI (não quebra o fluxo se falhar) */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const infiniteHandle = Deno.env.get("INFINITEPAY_HANDLE") ?? "";
    const paymentCheckTimeoutMs = Number(
      Deno.env.get("INFINITEPAY_PAYMENTCHECK_TIMEOUT_MS") ?? "3500"
    );

    // ✅ NOVO: polling (15s) + tempo máximo (pra não estourar timeout da Edge)
    const pollIntervalMs = Number(
      Deno.env.get("INFINITEPAY_VERIFY_POLL_INTERVAL_MS") ?? "15000"
    );
    const maxWaitMs = Number(
      Deno.env.get("INFINITEPAY_VERIFY_MAX_WAIT_MS") ?? "45000"
    );

    // ✅ Meta CAPI
    const metaPixelId = Deno.env.get("META_PIXEL_ID") ?? "";
    const metaAccessToken = Deno.env.get("META_ACCESS_TOKEN") ?? "";
    const metaTestEventCode = Deno.env.get("META_TEST_EVENT_CODE") ?? "";

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ success: false, message: "ENV Supabase ausente (URL/SERVICE_ROLE/ANON)" }, 400);
    }
    if (!infiniteHandle) {
      return json({ success: false, message: "INFINITEPAY_HANDLE ausente" }, 400);
    }

    const payload = await req.json().catch(() => ({} as any));
    const order_nsu = String(payload?.order_nsu ?? "").trim();

    if (!order_nsu) return json({ success: false, message: "order_nsu ausente" }, 400);

    // order_nsu padrão: doramasplus|<USER_ID>|<trial3|monthly|quarterly>|<timestamp>
    const parts = order_nsu.split("|");
    if (parts.length < 4) return json({ success: false, message: "order_nsu inválido" }, 400);

    const userIdFromOrder = parts[1];
    const plan = parts[2]; // trial3 | monthly | quarterly
    if (!userIdFromOrder) return json({ success: false, message: "user_id ausente" }, 400);
    if (plan !== "monthly" && plan !== "quarterly" && plan !== "trial3") {
      return json({ success: false, message: "plano inválido" }, 400);
    }

    // ✅ valida usuário logado (anti-fraude)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ success: false, message: "Sem auth (Bearer)" }, 401);
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return json({ success: false, message: "Auth inválida" }, 401);
    }
    if (userData.user.id !== userIdFromOrder) {
      return json({ success: false, message: "order_nsu não pertence ao usuário logado" }, 403);
    }

    // ✅ service role para updates
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // tenta pegar invoice_slug/transaction_nsu/event_id do seu banco
    let invoice_slug = "";
    let transaction_nsu = "";
    let eventIdForMeta = order_nsu;

    try {
      const { data: existing } = await supabase
        .from("pix_payments")
        .select("invoice_slug, transaction_nsu, status, event_id, meta_sent")
        .eq("order_nsu", order_nsu)
        .maybeSingle();

      if (existing?.invoice_slug) invoice_slug = String(existing.invoice_slug);
      if (existing?.transaction_nsu) transaction_nsu = String(existing.transaction_nsu);
      if (existing?.event_id && String(existing.event_id).trim()) {
        eventIdForMeta = String(existing.event_id).trim();
      }
    } catch {}

    // ✅ Confirma pagamento via payment_check (com timeout)
    // ✅ NOVO: tenta várias vezes (a cada 15s) antes de desistir
    let paid = false;
    let debugCheck: any = null;

    try {
      const startedAt = Date.now();
      const tries = Math.max(1, Math.ceil(maxWaitMs / Math.max(1000, pollIntervalMs)));

      for (let i = 0; i < tries; i++) {
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
        debugCheck = check;

        if (checkResp.ok && check?.success && check?.paid) {
          paid = true;
          break;
        }

        // se ainda não pagou, espera 15s e tenta de novo (desde que ainda tenha tempo)
        const elapsed = Date.now() - startedAt;
        const remaining = maxWaitMs - elapsed;
        const shouldWait = i < tries - 1 && remaining > 0;

        if (shouldWait) {
          const waitMs = Math.min(pollIntervalMs, remaining);
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }

      if (!paid) {
        return json(
          {
            success: false,
            message: "Pagamento ainda não confirmado",
            debug: debugCheck ?? null,
            polled: true,
            poll_interval_ms: pollIntervalMs,
            max_wait_ms: maxWaitMs,
          },
          200
        );
      }
    } catch (e) {
      return json({ success: false, message: "Falha ao confirmar pagamento", error: String(e) }, 500);
    }

    // ====== acumular dias se ainda estiver ativo ======
    const now = new Date();
    // ✅ dias por plano: trial3 = 3, monthly = 30, quarterly = 90
    const daysToAdd = plan === "quarterly" ? 90 : plan === "trial3" ? 1 : 30;
    let baseDate = now;

    try {
      const { data: currentSub } = await supabase
        .from("subscriptions")
        .select("status, end_at, current_period_end")
        .eq("user_id", userIdFromOrder)
        .maybeSingle();

      const { data: prof } = await supabase
        .from("profiles")
        .select("active, subscription_active_until")
        .eq("id", userIdFromOrder)
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

    const planName =
      plan === "quarterly"
        ? "DoramasPlus Trimestral"
        : plan === "trial3"
          ? "DoramasPlus Passe Teste"
          : "DoramasPlus Padrão";
    const planInterval = plan === "quarterly" ? "quarter" : plan === "trial3" ? "trial" : "month";
    const amountCents = plan === "quarterly" ? 4390 : plan === "trial3" ? 299 : 1590;
    const priceId =
      plan === "quarterly"
        ? "infinitepay_pix_4390"
        : plan === "trial3"
          ? "infinitepay_pix_299"
          : "infinitepay_pix_1590";

    // marca/atualiza pix_payments como paid (idempotente)
    try {
      await supabase.from("pix_payments").upsert(
        {
          user_id: userIdFromOrder,
          provider: "infinitepay",
          plan,
          amount_cents: amountCents,
          order_nsu,
          invoice_slug,
          transaction_nsu,
          status: "paid",
          paid_at: now.toISOString(),
          event_id: eventIdForMeta,
        },
        { onConflict: "order_nsu" }
      );
    } catch (e) {
      console.error("pix_payments upsert erro:", String(e));
    }

    // libera assinatura
    const baseSubscription = {
      user_id: userIdFromOrder,
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
      price_id: priceId,
      is_manual: false,
      notes: `InfinitePay (verify) - ${planName}`,
      last_renewed_at: now.toISOString(),
    };

    const { error: subErr } = await supabase
      .from("subscriptions")
      .upsert(baseSubscription, { onConflict: "user_id" });

    if (subErr) {
      return json({ success: false, message: "Pago, mas falhou liberar assinatura", error: subErr }, 500);
    }

    // atualiza profile
    try {
      await supabase
        .from("profiles")
        .update({
          active: true,
          subscription_active_until: endAt.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("id", userIdFromOrder);
    } catch {}

    // =========================
    // ✅✅✅ META CAPI PURCHASE (SEM DUPLICAR)
    // Regra: se profiles.meta_purchase_sent = true => NÃO manda Purchase
    // E trava por pagamento via pix_payments.meta_processing/meta_sent
    // =========================
    try {
      let shouldSendPurchase = false;

      const { data: profileMeta, error: metaErr } = await supabase
        .from("profiles")
        .select("meta_purchase_sent")
        .eq("id", userIdFromOrder)
        .maybeSingle();

      if (!metaErr) {
        shouldSendPurchase = profileMeta?.meta_purchase_sent !== true;
      }

      if (shouldSendPurchase && metaPixelId && metaAccessToken) {
        // 1) tenta pegar lock (evita duplicar em reenvio)
        const { data: lockRow } = await supabase
          .from("pix_payments")
          .update({ meta_processing: true })
          .eq("order_nsu", order_nsu)
          .eq("status", "paid")
          .eq("meta_sent", false)
          .eq("meta_processing", false)
          .select("order_nsu")
          .maybeSingle();

        if (!lockRow) {
          console.log("META SKIP (já em processamento ou já enviado):", order_nsu);
        } else {
          // 2) pega email
          let userEmail: string | null = null;
          try {
            const { data } = await supabase.auth.admin.getUserById(userIdFromOrder);
            userEmail = (data as any)?.user?.email ?? null;
          } catch {}

          // 3) envia
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

          // 4) flags
          if (ok) {
            try {
              await supabase
                .from("pix_payments")
                .update({ meta_sent: true, meta_processing: false })
                .eq("order_nsu", order_nsu);
            } catch {}

            try {
              await supabase
                .from("profiles")
                .update({ meta_purchase_sent: true })
                .eq("id", userIdFromOrder);
            } catch {}
          } else {
            try {
              await supabase
                .from("pix_payments")
                .update({ meta_processing: false })
                .eq("order_nsu", order_nsu);
            } catch {}
          }
        }
      } else {
        if (!shouldSendPurchase) console.log("Purchase SKIP (já enviado antes pro usuário):", userIdFromOrder);
        else console.log("META CAPI: pulado (META_PIXEL_ID/META_ACCESS_TOKEN ausentes)");
      }
    } catch (e) {
      // ⚠️ nunca travar liberação por causa de pixel
      console.error("META block exception (ignored):", String(e));
    }

    return json({ success: true, message: null, end_at: endAt.toISOString() }, 200);
  } catch (e) {
    return json({ success: false, message: String(e) }, 400);
  }
});
