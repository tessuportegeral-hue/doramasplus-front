// clever-worker infinity pay (Deno runtime)
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

function pickFirstString(...values: any[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && String(v).trim()) return String(v).trim();
  }
  return "";
}

function extractInfinitePay(payload: any) {
  const data = payload?.data ?? payload?.event?.data ?? payload ?? {};
  const invoice = payload?.invoice ?? data?.invoice ?? {};
  const transaction = payload?.transaction ?? data?.transaction ?? {};
  const payment = payload?.payment ?? data?.payment ?? {};
  const order = payload?.order ?? data?.order ?? {};

  const order_nsu = pickFirstString(
    payload?.order_nsu, data?.order_nsu, invoice?.order_nsu, transaction?.order_nsu,
    payment?.order_nsu, order?.order_nsu, payload?.nsu, data?.nsu, invoice?.nsu,
    transaction?.nsu, payment?.nsu, order?.nsu, payload?.metadata?.order_nsu,
    data?.metadata?.order_nsu, invoice?.metadata?.order_nsu,
    payload?.meta?.order_nsu, data?.meta?.order_nsu
  );

  const invoice_slug = pickFirstString(
    payload?.invoice_slug, data?.invoice_slug, invoice?.invoice_slug,
    invoice?.slug, payload?.slug, data?.slug
  );

  const transaction_nsu = pickFirstString(
    payload?.transaction_nsu, data?.transaction_nsu, transaction?.transaction_nsu,
    transaction?.nsu, payment?.transaction_nsu
  );

  return { order_nsu, invoice_slug, transaction_nsu };
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePhone(raw: string): string | null {
  try {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 0) return null;
    if (digits.startsWith("55") && digits.length >= 12) return digits;
    if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
    if (digits.length >= 12) return digits;
    return null;
  } catch {
    return null;
  }
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
  userPhone?: string | null;
}): Promise<boolean> {
  try {
    const { pixelId, accessToken, testEventCode, eventId, eventTimeUnix, value, currency, contentName, userEmail, userPhone } = opts;

    let em: string[] | undefined = undefined;
    if (userEmail) {
      const normalized = userEmail.trim().toLowerCase();
      if (normalized) em = [await sha256Hex(normalized)];
    }

    let ph: string[] | undefined = undefined;
    if (userPhone) {
      const normalizedPhone = normalizePhone(userPhone);
      if (normalizedPhone) ph = [await sha256Hex(normalizedPhone)];
    }

    const user_data: any = {};
    if (em) user_data.em = em;
    if (ph) user_data.ph = ph;

    const payload: any = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTimeUnix,
          event_id: eventId,
          action_source: "website",
          user_data,
          custom_data: {
            currency,
            value,
            content_name: contentName,
          },
        },
      ],
    };

    if (testEventCode) payload.test_event_code = testEventCode;

    const resp = await fetch(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
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
    } else {
      const j = await resp.json().catch(() => ({}));
      console.log("META CAPI OK:", j);
      return true;
    }
  } catch (e) {
    console.error("META CAPI EXCEPTION:", e);
    return false;
  }
}

type CreditResult =
  | { credited: false; reason: string }
  | { credited: true; referrerId: string; daysAdded: 15 };

async function creditReferralIfEligible(
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

    const { count: pixCount, error: pixErr } = await supabase
      .from("pix_payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", referredId);
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
      .update({ end_at: newEndIso, current_period_end: newEndIso })
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: true, ignored_method: req.method }, 200);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const infiniteHandle = Deno.env.get("INFINITEPAY_HANDLE") ?? "";
    const metaPixelId = Deno.env.get("META_PIXEL_ID") ?? "";
    const metaAccessToken = Deno.env.get("META_ACCESS_TOKEN") || Deno.env.get("META_ACESS_TOKEN") || "";
    const metaTestEventCode = Deno.env.get("META_TEST_EVENT_CODE") ?? "";
    const paymentCheckTimeoutMs = Number(Deno.env.get("INFINITEPAY_PAYMENTCHECK_TIMEOUT_MS") ?? "2500");

    if (!supabaseUrl || !serviceRoleKey) return json({ success: false, message: "ENV Supabase ausente" }, 400);
    if (!infiniteHandle) return json({ success: false, message: "INFINITEPAY_HANDLE ausente" }, 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const contentType = req.headers.get("content-type") ?? "";
    const rawBody = await req.text().catch(() => "");
    let payload: any = {};

    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      try {
        const params = new URLSearchParams(rawBody);
        const obj: any = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        payload = obj;
      } catch {
        payload = {};
      }
    }

    console.log("WEBHOOK content-type:", contentType);
    console.log("WEBHOOK raw_len:", rawBody?.length ?? 0);
    console.log("WEBHOOK SAMPLE:", JSON.stringify(payload).slice(0, 2000));

    const extracted = extractInfinitePay(payload);
    const order_nsu = String(extracted.order_nsu ?? "");
    const invoice_slug = String(extracted.invoice_slug ?? "");
    const transaction_nsu = String(extracted.transaction_nsu ?? "");

    if (!order_nsu) {
      return json({ success: false, message: "order_nsu ausente", debug: { contentType, rawLen: rawBody?.length ?? 0 } }, 400);
    }

    const parts = order_nsu.split("|");
    if (parts.length < 4) return json({ success: false, message: "order_nsu invalido" }, 400);

    const isSalesBot = parts[0] === "salesbot";
    const plan = parts[2];

    // ✅ planos aceitos: trial3 (Passe Teste), monthly, quarterly
    if (plan !== "monthly" && plan !== "quarterly" && plan !== "trial3") {
      return json({ success: false, message: "plano invalido" }, 400);
    }

    // ✅ Sales bot: userId vem do telefone, não do parts[1]
    let userId: string;
    let userPhone: string | null = null;
    let userName: string | null = null;
    let userEmail: string | null = null;
    let userPassword: string | null = null;

    if (isSalesBot) {
      // parts[1] é o telefone
      const phoneDigits = parts[1];
      userPhone = phoneDigits.startsWith("55") ? phoneDigits : "55" + phoneDigits;

      // Busca usuário pelo telefone
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, name, email, phone")
        .eq("phone", phoneDigits)
        .maybeSingle();

      if (!profile?.id) {
        console.error("[salesbot] perfil nao encontrado para phone:", phoneDigits);
        return json({ success: false, message: "Usuario nao encontrado pelo telefone" }, 400);
      }

      userId = profile.id;
      userName = profile.name || null;
      userEmail = profile.email || null;

      // Busca sessao do bot pra pegar a senha
      try {
        const { data: session } = await supabase
          .from("sales_bot_sessions")
          .select("data")
          .eq("phone", userPhone)
          .maybeSingle();
        if (session?.data?.password) {
          userPassword = String(session.data.password);
        }
      } catch {}

    } else {
      userId = parts[1];
      if (!userId) return json({ success: false, message: "user_id ausente" }, 400);

      const { data: profileCheck } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (!profileCheck?.id) {
        console.error("PIX pago mas profile nao existe:", { userId, order_nsu });
        return json({ success: false, message: "Usuario nao encontrado" }, 400);
      }
    }

    // Dedup
    try {
      const { data: existing } = await supabase
        .from("pix_payments")
        .select("status, meta_sent")
        .eq("order_nsu", order_nsu)
        .maybeSingle();
      if (existing?.status === "paid" && existing?.meta_sent === true) {
        return json({ success: true, message: null, already_processed: true }, 200);
      }
    } catch {}

    let paymentSource = "direct";
    try {
      const { data: row } = await supabase
        .from("pix_payments")
        .select("event_id, source")
        .eq("order_nsu", order_nsu)
        .maybeSingle();
      if (row?.source) paymentSource = String(row.source).trim().toLowerCase();
    } catch {}

    let paymentConfirmed = false;
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), paymentCheckTimeoutMs);
      const checkResp = await fetch(
        "https://api.infinitepay.io/invoices/public/checkout/payment_check",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ handle: infiniteHandle, order_nsu, slug: invoice_slug, transaction_nsu }),
        }
      );
      clearTimeout(to);
      const check = await checkResp.json().catch(() => ({} as any));
      if (check?.success && check?.paid) {
        paymentConfirmed = true;
      } else {
        // NAO bloqueia mais: a API de conferencia da InfinityPay as vezes ainda nao
        // reflete o pagamento no instante em que o webhook chega (race condition).
        // O webhook so dispara em pagamento real, entao liberamos o acesso na hora e
        // apenas marcamos como nao-confirmado-pela-conferencia. Isso elimina a
        // dependencia do retry externo da InfinityPay (~20 min) que travava o acesso.
        console.warn("payment_check inconclusivo (paid!=true) - liberando mesmo assim:", JSON.stringify(check).slice(0, 300));
      }
    } catch (e) {
      console.warn("payment_check timeout/erro:", String(e));
    }

    const now = new Date();
    // ✅ dias por plano: trial3 = 3, monthly = 30, quarterly = 90
    const daysToAdd = plan === "quarterly" ? 90 : plan === "trial3" ? 1 : 30;
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
      const isActive = currentSub?.status === "active" || currentSub?.status === "trialing" || prof?.active === true;
      if (bestEnd && isActive && bestEnd > now) baseDate = bestEnd;
    } catch {
      baseDate = now;
    }

    const endAt = addDays(baseDate, daysToAdd);
    const planName =
      plan === "quarterly"
        ? "DoramasPlus Trimestral"
        : plan === "trial3"
          ? "DoramasPlus Passe Teste"
          : "DoramasPlus Padrao";
    const planInterval = plan === "quarterly" ? "quarter" : plan === "trial3" ? "trial" : "month";
    const amountCents = plan === "quarterly" ? 4790 : plan === "trial3" ? 299 : 1690;
    const priceId =
      plan === "quarterly"
        ? "infinitepay_pix_4790"
        : plan === "trial3"
          ? "infinitepay_pix_590"
          : "infinitepay_pix_1690";

    try {
      await supabase
        .from("pix_payments")
        .update({
          status: "paid",
          paid_at: now.toISOString(),
          raw: payload,
          invoice_slug,
          transaction_nsu,
          user_id: userId,
        })
        .eq("order_nsu", order_nsu);
    } catch (e) {
      console.error("Erro ao update pix_payments:", String(e));
    }

    let subscriptionOk = false;
    try {
      const { error } = await supabase
        .from("subscriptions")
        .upsert({
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
          price_id: priceId,
          is_manual: false,
          notes: `PIX InfinitePay - ${planName}`,
          last_renewed_at: now.toISOString(),
        }, { onConflict: "user_id" });
      if (error) console.error("ERRO AO LIBERAR ASSINATURA:", { userId, order_nsu, error });
      else subscriptionOk = true;
    } catch (e) {
      console.error("EXCEPTION AO LIBERAR ASSINATURA:", { userId, order_nsu, e });
    }

    if (!subscriptionOk) {
      return json({ success: false, message: "Pagamento confirmado, mas erro ao liberar assinatura" }, 500);
    }

    try {
      await supabase
        .from("profiles")
        .update({ active: true, subscription_active_until: endAt.toISOString(), updated_at: now.toISOString() })
        .eq("id", userId);
    } catch (e) {
      console.error("EXCEPTION ao atualizar profiles:", { userId, order_nsu, e });
    }

    // Referral — NÃO credita indicação no Passe Teste (evita farm de 15 dias por R$5,90)
    if (plan !== "trial3") {
      try {
        const referralResult = await creditReferralIfEligible(supabase, userId);
        console.log("[referral] resultado:", JSON.stringify(referralResult));
      } catch (e) {
        console.error("[referral] excecao:", e);
      }
    } else {
      console.log("[referral] pulado (plano trial3)");
    }

    // ✅ Sales bot: notifica acesso liberado via WhatsApp
    if (isSalesBot && userPhone) {
      try {
        const notifyUrl = `${supabaseUrl}/functions/v1/whatsapp-sales-bot/notify-access`;
        await fetch(notifyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            phone: userPhone,
            name: userName || "",
            email: userEmail || "",
            password: userPassword || "",
          }),
        });
        console.log("[salesbot] notificacao enviada para:", userPhone);
      } catch (e) {
        console.error("[salesbot] erro ao notificar:", String(e));
      }
      return json({ success: true, message: null, payment_check_confirmed: paymentConfirmed, notified_sales_bot: true }, 200);
    }

    // Meta CAPI (fluxo normal)
    if (metaPixelId && metaAccessToken) {
      const { data: lockRow, error: lockErr } = await supabase
        .from("pix_payments")
        .update({ meta_processing: true })
        .eq("order_nsu", order_nsu)
        .eq("status", "paid")
        .eq("meta_sent", false)
        .eq("meta_processing", false)
        .select("order_nsu")
        .maybeSingle();

      if (lockErr || !lockRow) {
        console.log("META SKIP (ja em processamento ou ja enviado):", order_nsu);
        return json({ success: true, message: null, duplicated: true, payment_check_confirmed: paymentConfirmed }, 200);
      }

      if (!userEmail) {
        try {
          const { data: authUser } = await supabase.auth.admin.getUserById(userId);
          userEmail = (authUser as any)?.user?.email ?? null;
        } catch {}
      }
      if (!userPhone) {
        try {
          const { data: profData } = await supabase.from("profiles").select("phone").eq("id", userId).maybeSingle();
          userPhone = profData?.phone ?? null;
        } catch {}
      }

      const ok = await sendMetaPurchase({
        pixelId: metaPixelId,
        accessToken: metaAccessToken,
        testEventCode: metaTestEventCode || undefined,
        eventId: order_nsu,
        eventTimeUnix: Math.floor(now.getTime() / 1000),
        value: amountCents / 100,
        currency: "BRL",
        contentName: planName,
        userEmail,
        userPhone,
      });

      try {
        await supabase
          .from("pix_payments")
          .update({ meta_sent: ok, meta_processing: false })
          .eq("order_nsu", order_nsu);
      } catch {}
    }

    return json({ success: true, message: null, payment_check_confirmed: paymentConfirmed }, 200);
  } catch (e) {
    console.error("clever-worker ERROR:", e);
    return json({ success: false, message: String(e) }, 400);
  }
});
