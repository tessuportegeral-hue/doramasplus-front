import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditReferralIfEligible, resolvePendingReferralsForReferrer } from "../_shared/referral.ts";
import { grantSubscriptionAndProfile } from "../_shared/grant-subscription.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DEFAULT_PASSWORD = "123456";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";

// ✅ 31/07: alerta IMEDIATO (email+WhatsApp via admin-whatsapp-notify) quando
// esse webhook falha de verdade e devolve erro pra Asaas — é exatamente
// esse tipo de resposta não-200 repetida que faz a Asaas pausar a fila
// inteira depois de 15 falhas seguidas (ver asaas-webhook-queue-pause).
// Fire-and-forget, nunca atrasa/bloqueia a resposta ao webhook.
function alertWebhookFailure(context: string, detail: string) {
  fetch(`${SUPABASE_URL}/functions/v1/admin-whatsapp-notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-check-secret": "dp_admin_notify_h4t8w2" },
    body: JSON.stringify({
      message: `🚨 DoramasPlus: asaas-webhook falhou (${context}) — isso conta pra fila da Asaas pausar depois de repetir. Detalhe: ${detail}`,
    }),
  }).catch((e) => console.error("[asaas-webhook] alertWebhookFailure fail:", String(e)));
}

function getMetaCredsForNumber(phoneNumberId: string | null): { pixelId: string; token: string; pageId: string } {
  if (phoneNumberId === "1253472567838504") {
    return {
      pixelId: Deno.env.get("META_PIXEL_ID_WA") || "",
      token:   Deno.env.get("META_ACCESS_TOKEN_WA") || "",
      pageId:  "810357348827172",
    };
  }
  return {
    pixelId: Deno.env.get("META_PIXEL_ID_WA") || "",
    token:   Deno.env.get("META_ACCESS_TOKEN_WA") || "",
    pageId:  "810357348827172",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
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
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim().toLowerCase()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ✅ 28/07: Asaas não avisa o dono da conta quando entra uma venda de verdade
// (só o comprador recebe recibo). Manda um email curto pra cada venda
// confirmada (site ou bot WhatsApp), best-effort — nunca bloqueia o
// processamento do pagamento em si.
// ✅ 29/07: separa nome/email/telefone em vez de um "identifier" genérico
// (antes só mostrava email OU telefone, nunca os dois) — pedido explícito
// pra facilitar contato/contexto direto do email de notificação.
async function notifySale(opts: {
  source: "site" | "whatsapp_bot";
  plan: string;
  amountCents: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<{ ok: boolean; status?: number; body?: string; error?: string; key_present: boolean }> {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return { ok: false, error: "missing_env", key_present: !!RESEND_API_KEY };
  const planLabel =
    opts.plan === "quarterly" ? "Trimestral" :
    opts.plan === "series" ? "1 Série" :
    opts.plan === "trial3" ? "Passe Teste" : "Mensal";
  const valueLabel = `R$ ${(opts.amountCents / 100).toFixed(2).replace(".", ",")}`;
  const sourceLabel = opts.source === "site" ? "Site" : "Bot WhatsApp";
  const nameLabel = opts.name?.trim() || "—";
  const emailLabel = opts.email?.trim() || "—";
  const phoneLabel = opts.phone?.trim() || "—";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ALERT_EMAIL],
        subject: `💰 Nova venda: ${planLabel} - ${valueLabel}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
          <p><b>Venda confirmada via Asaas (Pix)</b></p>
          <p>Origem: ${sourceLabel}<br>Plano: ${planLabel}<br>Valor: ${valueLabel}<br>Nome: ${nameLabel}<br>Email: ${emailLabel}<br>Telefone: ${phoneLabel}</p>
        </div>`,
      }),
    });
    const bodyText = await res.text().catch(() => "");
    console.log("[asaas-webhook] notifySale resend status:", res.status, "body:", bodyText.slice(0, 300));
    return { ok: res.ok, status: res.status, body: bodyText.slice(0, 300), key_present: true };
  } catch (e) {
    console.error("[asaas-webhook] notifySale email fail:", String(e));
    return { ok: false, error: String(e), key_present: true };
  }
}

async function dispararPixel(phone: string, email: string | null, value: number, plan: string, eventId: string, pixPaymentId?: string, ctwaClid?: string | null, phoneNumberId?: string | null) {
  const { pixelId, token, pageId } = getMetaCredsForNumber(phoneNumberId ?? null);
  const hasClid = !!ctwaClid;
  console.log("[meta-wa] pixel:", pixelId ? "OK " + pixelId : "AUSENTE", "token:", token ? "OK len="+token.length : "AUSENTE", "ctwa_clid:", hasClid ? "OK" : "AUSENTE", "phoneNumberId:", phoneNumberId || "default", "pageId:", pageId, "action_source:", hasClid ? "business_messaging" : "other");
  if (!pixelId || !token) {
    console.warn("[meta-wa] credenciais WA ausentes");
    if (pixPaymentId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from("pix_payments").update({ meta_error: "credenciais ausentes: pixelId=" + (pixelId||"VAZIO") + " token=" + (token ? "OK" : "VAZIO") }).eq("id", pixPaymentId);
    }
    return false;
  }
  try {
    const phoneClean = phone.replace(/\D/g, "");
    const phoneHash = await sha256hex(phoneClean);
    const emailHash = email ? await sha256hex(email) : null;
    const contentName = plan === "quarterly" ? "DoramasPlus Trimestral" : plan === "series" ? "DoramasPlus 1 Serie" : "DoramasPlus Mensal";

    let eventData: any;
    if (hasClid) {
      const userData: Record<string, any> = { ph: [phoneHash], page_id: pageId, ctwa_clid: ctwaClid };
      if (emailHash) userData.em = [emailHash];
      eventData = {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: userData,
        custom_data: { value, currency: "BRL", content_name: contentName, content_type: "product" },
      };
    } else {
      const userData: Record<string, any> = { ph: [phoneHash] };
      if (emailHash) userData.em = [emailHash];
      eventData = {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "other",
        user_data: userData,
        custom_data: { value, currency: "BRL", content_name: contentName, content_type: "product" },
      };
    }

    const body = { data: [eventData] };
    console.log("[meta-wa] enviando payload:", JSON.stringify(body).slice(0, 1000));
    const url = `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${token}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const resText = await res.text();
    console.log("[meta-wa] resposta status:", res.status, "body:", resText.slice(0, 500));
    let resBody: any = {};
    try { resBody = JSON.parse(resText); } catch {}
    const ok = res.ok && Number(resBody?.events_received ?? 0) >= 1;
    console.log("[meta-wa] resultado:", ok ? "SUCESSO" : "FALHA", "events_received:", resBody?.events_received);
    if (pixPaymentId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      if (ok) {
        await supabase.from("pix_payments").update({ meta_sent: true, meta_error: null }).eq("id", pixPaymentId);
        console.log("[meta-wa] meta_sent atualizado para true, id:", pixPaymentId);
      } else {
        const errMsg = `status=${res.status} events_received=${resBody?.events_received ?? 'N/A'} body=${resText.slice(0, 500)}`;
        await supabase.from("pix_payments").update({ meta_error: errMsg }).eq("id", pixPaymentId);
        console.log("[meta-wa] meta_error salvo:", errMsg.slice(0, 200));
      }
    }
    return ok;
  } catch (e) {
    console.error("[meta-wa] erro:", e);
    if (pixPaymentId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from("pix_payments").update({ meta_error: "exception: " + String(e) }).eq("id", pixPaymentId);
    }
    return false;
  }
}

// ✅ 31/07: compra pelo SITE nunca disparava evento pro Meta CAPI — só o
// caminho do bot WhatsApp (dispararPixel acima) mandava. Isso deixava o
// Meta "cego" pra vendas do site, otimizando anúncio sem saber quando uma
// venda de verdade fecha por ali. Usa as credenciais gerais (mesmas do
// infinitepay-reconcile, action_source "website"), não as _WA do bot —
// e, diferente do infinitepay-reconcile, já manda fbc/fbp quando disponível
// (capturados no checkout, ver SubscriptionPlans.jsx) pra melhorar o match.
// META_ACCESS_TOKEN tem uma variante com typo já vista em outra função
// (META_ACESS_TOKEN, 1 C) — lê os dois nomes por segurança.
async function dispararPixelSite(opts: {
  email: string | null;
  value: number;
  plan: string;
  eventId: string;
  pixPaymentId?: string;
  fbclid?: string | null;
  fbp?: string | null;
}) {
  const pixelId = Deno.env.get("META_PIXEL_ID") || "";
  const token = Deno.env.get("META_ACCESS_TOKEN") || Deno.env.get("META_ACESS_TOKEN") || "";
  if (!pixelId || !token) {
    console.warn("[meta-site] credenciais ausentes: pixelId=", pixelId ? "OK" : "VAZIO", "token=", token ? "OK" : "VAZIO");
    if (opts.pixPaymentId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from("pix_payments").update({ meta_error: "credenciais ausentes (site)" }).eq("id", opts.pixPaymentId);
    }
    return false;
  }
  try {
    const emailHash = opts.email ? await sha256hex(opts.email) : null;
    const contentName = opts.plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Mensal";
    const userData: Record<string, any> = {};
    if (emailHash) userData.em = [emailHash];
    if (opts.fbp) userData.fbp = opts.fbp;
    if (opts.fbclid) userData.fbc = `fb.1.${Date.now()}.${opts.fbclid}`;

    const body = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: opts.eventId,
          action_source: "website",
          user_data: userData,
          custom_data: { value: opts.value, currency: "BRL", content_name: contentName, content_type: "product" },
        },
      ],
    };
    const url = `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${token}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const resText = await res.text();
    let resBody: any = {};
    try { resBody = JSON.parse(resText); } catch {}
    const ok = res.ok && Number(resBody?.events_received ?? 0) >= 1;
    console.log("[meta-site] resultado:", ok ? "SUCESSO" : "FALHA", resText.slice(0, 300));
    if (opts.pixPaymentId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      if (ok) {
        await supabase.from("pix_payments").update({ meta_sent: true, meta_error: null }).eq("id", opts.pixPaymentId);
      } else {
        await supabase.from("pix_payments").update({ meta_error: `status=${res.status} body=${resText.slice(0, 300)}` }).eq("id", opts.pixPaymentId);
      }
    }
    return ok;
  } catch (e) {
    console.error("[meta-site] erro:", e);
    if (opts.pixPaymentId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from("pix_payments").update({ meta_error: "exception: " + String(e) }).eq("id", opts.pixPaymentId);
    }
    return false;
  }
}

async function ensureProfile(supabase: any, phoneDigits: string) {
  const fakeEmail = `${phoneDigits}@doramasplus.com`.toLowerCase();
  let userId: string | null = null;
  try {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: fakeEmail, password: DEFAULT_PASSWORD, email_confirm: true,
      user_metadata: { name: "", phone: phoneDigits },
    });
    if (error) {
      const m = String(error.message || "").toLowerCase();
      if (m.includes("already") || m.includes("exists") || m.includes("registered")) {
        const { data: existing } = await supabase.from("profiles").select("id").eq("email", fakeEmail).maybeSingle();
        userId = existing?.id || null;
      } else {
        console.error("[asaas-webhook] createUser erro:", error.message);
      }
    } else {
      userId = created?.user?.id || null;
    }
  } catch (e) { console.error("[asaas-webhook] ensureProfile erro:", e); }
  if (!userId) return null;
  await supabase.from("profiles").upsert({ id: userId, name: "", phone: phoneDigits, email: fakeEmail }, { onConflict: "id" });
  return { id: userId, name: null as string | null, email: fakeEmail, phone: phoneDigits };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST") return json({ ok: true }, 200);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = await req.json().catch(() => ({}));
    console.log("[asaas-webhook] payload:", JSON.stringify(payload).slice(0, 2000));

    const event = String(payload?.event || "");
    const payment = payload?.payment || {};

    if (event !== "PAYMENT_RECEIVED" && event !== "PAYMENT_CONFIRMED") {
      return json({ ok: true, ignored: true, event }, 200);
    }

    const externalReference = String(payment?.externalReference || "");
    const asaasPaymentId = String(payment?.id || "");
    const value = Number(payment?.value || 0);

    if (!externalReference) {
      console.log("[asaas-webhook] externalReference ausente, ignorando pagamento:", asaasPaymentId);
      return json({ ok: true, ignored: true, reason: "externalReference ausente" }, 200);
    }
    const parts = externalReference.split("|");

    if (parts[0] === "doramasplus") {
      if (parts.length < 3) {
        return json({ ok: true, ignored: true, reason: "order_nsu invalido (site)" }, 200);
      }
      const userId = parts[1];
      const plan = parts[2];
      if (!["monthly", "quarterly", "trial3"].includes(plan)) {
        return json({ ok: true, ignored: true, reason: "plano invalido (site): " + plan }, 200);
      }

      const amountCentsSite = Math.round(value * 100);
      const nowSite = new Date();

      const { data: existingSitePay } = await supabase
        .from("pix_payments")
        .select("id, status, meta_sent, fbclid, fbp, event_id")
        .eq("order_nsu", externalReference)
        .maybeSingle();

      if (existingSitePay?.status === "paid") {
        return json({ ok: true, already_processed: true }, 200);
      }

      try {
        await supabase.from("pix_payments").upsert({
          user_id: userId,
          provider: "asaas",
          plan,
          amount_cents: amountCentsSite,
          order_nsu: externalReference,
          status: "paid",
          paid_at: nowSite.toISOString(),
          raw: payload,
        }, { onConflict: "order_nsu" });
      } catch (e) {
        console.error("[asaas-webhook] site pix_payments upsert erro:", String(e));
      }

      const daysToAddSite = plan === "quarterly" ? 90 : plan === "trial3" ? 1 : 30;
      let baseDateSite = nowSite;
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
        const bestEnd = maxDate(
          maxDate(
            currentSub?.end_at ? new Date(currentSub.end_at) : null,
            currentSub?.current_period_end ? new Date(currentSub.current_period_end) : null,
          ),
          prof?.subscription_active_until ? new Date(prof.subscription_active_until) : null,
        );
        const isActive = currentSub?.status === "active" || currentSub?.status === "trialing" || prof?.active === true;
        if (bestEnd && isActive && bestEnd > nowSite) baseDateSite = bestEnd;
      } catch {}

      const endAtSite = addDays(baseDateSite, daysToAddSite);
      const planNameSite =
        plan === "quarterly" ? "DoramasPlus Trimestral" : plan === "trial3" ? "DoramasPlus Passe Teste" : "DoramasPlus Padrao";
      const planIntervalSite = plan === "quarterly" ? "quarter" : plan === "trial3" ? "trial" : "month";

      const grantResultSite = await grantSubscriptionAndProfile(supabase, userId, {
        status: "active",
        start_at: nowSite.toISOString(),
        end_at: endAtSite.toISOString(),
        current_period_end: endAtSite.toISOString(),
        plan_name: planNameSite,
        plan_interval: planIntervalSite,
        source: "asaas",
        provider: "asaas",
        provider_ref: asaasPaymentId,
        order_nsu: externalReference,
        price_id: plan === "quarterly" ? "asaas_pix_4790" : "asaas_pix_1690",
        is_manual: false,
        notes: `PIX Asaas (site) - ${planNameSite}`,
        last_renewed_at: nowSite.toISOString(),
      });

      if (!grantResultSite.ok) {
        console.error("[asaas-webhook] site subscription error:", grantResultSite.error);
        alertWebhookFailure("liberar assinatura, site", String(grantResultSite.error));
        return json({ ok: false, error: "erro ao liberar assinatura" }, 500);
      }

      const { data: profSite } = await supabase.from("profiles").select("name, email, phone").eq("id", userId).maybeSingle();
      await notifySale({ source: "site", plan, amountCents: amountCentsSite, name: profSite?.name || null, email: profSite?.email || null, phone: profSite?.phone || null });

      if (!existingSitePay?.meta_sent) {
        await dispararPixelSite({
          email: profSite?.email || null,
          value: amountCentsSite / 100,
          plan,
          eventId: existingSitePay?.event_id || externalReference,
          pixPaymentId: existingSitePay?.id,
          fbclid: existingSitePay?.fbclid || null,
          fbp: existingSitePay?.fbp || null,
        });
      }

      if (plan !== "trial3") {
        try {
          const referralResult = await creditReferralIfEligible(supabase, userId);
          console.log("[referral] resultado (asaas site):", JSON.stringify(referralResult));
        } catch (e) {
          console.error("[referral] excecao:", e);
        }
      }
      try {
        const pendingResult = await resolvePendingReferralsForReferrer(supabase, userId);
        if (pendingResult.resolved > 0) {
          console.log("[referral] pending resolvidos (asaas site):", pendingResult.resolved, "para", userId);
        }
      } catch (e) {
        console.error("[referral] excecao ao resolver pending:", e);
      }

      return json({ ok: true, userId, plan, endAt: endAtSite.toISOString() }, 200);
    }

    if (parts.length < 3 || parts[0] !== "salesbot_asaas") {
      console.log("[asaas-webhook] externalReference invalido, ignorando:", externalReference);
      return json({ ok: true, ignored: true, reason: "externalReference invalido" }, 200);
    }

    const phoneDigits = parts[1];
    const plan = parts[2];
    if (!["monthly", "quarterly", "series"].includes(plan)) {
      console.log("[asaas-webhook] plano invalido, ignorando:", plan, "ref:", externalReference);
      return json({ ok: true, ignored: true, reason: "plano invalido: " + plan }, 200);
    }

    const userPhone = phoneDigits.startsWith("55") ? phoneDigits : "55" + phoneDigits;
    const amountCents = Math.round(value * 100);
    const now = new Date();
    const eventId = `asaas_${externalReference}`;

    const { data: existingPay } = await supabase.from("pix_payments").select("id, status, meta_sent, ctwa_clid, user_id, receiving_phone_number_id").eq("order_nsu", externalReference).maybeSingle();
    const savedCtwaClid = existingPay?.ctwa_clid || null;
    const receivingPhoneNumberId: string | null = existingPay?.receiving_phone_number_id || null;

    if (existingPay?.status === "paid") {
      if (!existingPay.meta_sent) {
        console.log("[asaas-webhook] reprocessando pixel para:", externalReference);
        await dispararPixel(userPhone, null, value, plan, eventId, existingPay.id, savedCtwaClid, receivingPhoneNumberId);
      }
      return json({ ok: true, already_processed: true }, 200);
    }

    if (plan === "series") {
      const { data: ins } = await supabase.from("pix_payments").upsert({
        provider: "asaas", plan, amount_cents: amountCents, order_nsu: externalReference,
        status: "paid", paid_at: now.toISOString(), source: "whatsapp_sales_bot",
        raw: payload, meta_sent: false, meta_processing: false,
        ctwa_clid: savedCtwaClid,
        receiving_phone_number_id: receivingPhoneNumberId,
      }, { onConflict: "order_nsu" }).select("id").maybeSingle();

      await dispararPixel(userPhone, null, value, plan, eventId, ins?.id, savedCtwaClid, receivingPhoneNumberId);

      // ✅ 29/07: tenta achar nome/email já cadastrados pelo telefone (mesmo
      // padrão de match de dois formatos usado no resto do arquivo) — série
      // é compra rápida, pode não ter perfil ainda, fica "—" nesse caso.
      let seriesName: string | null = null;
      let seriesEmail: string | null = null;
      try {
        const phoneCandidatesSeries = Array.from(new Set([
          phoneDigits,
          phoneDigits.startsWith("55") ? phoneDigits.slice(2) : "55" + phoneDigits,
        ]));
        const { data: seriesProfile } = await supabase.from("profiles").select("name, email").in("phone", phoneCandidatesSeries).limit(1).maybeSingle();
        seriesName = seriesProfile?.name || null;
        seriesEmail = seriesProfile?.email || null;
      } catch {}
      await notifySale({ source: "whatsapp_bot", plan, amountCents, name: seriesName, email: seriesEmail, phone: userPhone });

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-sales-bot/notify-access`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ phone: userPhone, name: "", email: "", plan: "series" }),
        });
      } catch (e) { console.error("[asaas-webhook] notify series error:", e); }

      return json({ ok: true, plan: "series", phone: userPhone }, 200);
    }

    let profile: any = null;
    if (existingPay?.user_id) {
      const { data: byId } = await supabase.from("profiles").select("id, name, email, phone, active").eq("id", existingPay.user_id).maybeSingle();
      if (byId?.id) profile = byId;
    }
    if (!profile?.id) {
      const phoneCandidates = Array.from(new Set([
        phoneDigits,
        phoneDigits.startsWith("55") ? phoneDigits.slice(2) : "55" + phoneDigits,
      ]));
      const { data: profileMatches } = await supabase.from("profiles").select("id, name, email, phone, active").in("phone", phoneCandidates).limit(5);
      profile = (profileMatches || []).find((p: any) => p.active) || (profileMatches || [])[0] || null;
    }
    if (!profile?.id) {
      console.warn("[asaas-webhook] perfil nao encontrado, criando conta:", phoneDigits);
      profile = await ensureProfile(supabase, phoneDigits);
    }
    if (!profile?.id) { console.error("[asaas-webhook] falha ao criar/achar perfil:", phoneDigits); return json({ ok: false, error: "usuario nao encontrado" }, 400); }

    const userId = profile.id;
    const userName = profile.name || null;
    const userEmail = profile.email || null;

    const daysToAdd = plan === "quarterly" ? 90 : 30;
    let baseDate = now;
    try {
      const { data: currentSub } = await supabase.from("subscriptions").select("status, end_at, current_period_end").eq("user_id", userId).maybeSingle();
      const { data: prof } = await supabase.from("profiles").select("active, subscription_active_until").eq("id", userId).maybeSingle();
      const bestEnd = maxDate(maxDate(currentSub?.end_at ? new Date(currentSub.end_at) : null, currentSub?.current_period_end ? new Date(currentSub.current_period_end) : null), prof?.subscription_active_until ? new Date(prof.subscription_active_until) : null);
      if (bestEnd && (currentSub?.status === "active" || prof?.active === true) && bestEnd > now) baseDate = bestEnd;
    } catch {}

    const endAt = addDays(baseDate, daysToAdd);
    const planName = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrao";
    const planInterval = plan === "quarterly" ? "quarter" : "month";

    const { data: ins } = await supabase.from("pix_payments").upsert({
      user_id: userId, provider: "asaas", plan, amount_cents: amountCents,
      order_nsu: externalReference, status: "paid", paid_at: now.toISOString(),
      source: "whatsapp_sales_bot", raw: payload, meta_sent: false, meta_processing: false,
      ctwa_clid: savedCtwaClid,
      receiving_phone_number_id: receivingPhoneNumberId,
    }, { onConflict: "order_nsu" }).select("id").maybeSingle();

    const grantResult = await grantSubscriptionAndProfile(supabase, userId, {
      status: "active",
      start_at: now.toISOString(),
      end_at: endAt.toISOString(),
      current_period_end: endAt.toISOString(),
      plan_name: planName,
      plan_interval: planInterval,
      source: "asaas",
      provider: "asaas",
      provider_ref: asaasPaymentId,
      order_nsu: externalReference,
      price_id: plan === "quarterly" ? "asaas_pix_4790" : "asaas_pix_1690",
      is_manual: false,
      notes: `PIX Asaas - ${planName}`,
      last_renewed_at: now.toISOString(),
    });

    if (!grantResult.ok) {
      console.error("[asaas-webhook] subscription error:", grantResult.error);
      alertWebhookFailure("liberar assinatura, bot WhatsApp", String(grantResult.error));
      return json({ ok: false, error: "erro ao liberar assinatura" }, 500);
    }

    await notifySale({ source: "whatsapp_bot", plan, amountCents, name: userName, email: userEmail, phone: userPhone });

    try {
      const referralResult = await creditReferralIfEligible(supabase, userId);
      console.log("[referral] resultado (asaas):", JSON.stringify(referralResult));
    } catch (e) {
      console.error("[referral] excecao:", e);
    }
    try {
      const pendingResult = await resolvePendingReferralsForReferrer(supabase, userId);
      if (pendingResult.resolved > 0) {
        console.log("[referral] pending resolvidos (asaas):", pendingResult.resolved, "para", userId);
      }
    } catch (e) {
      console.error("[referral] excecao ao resolver pending:", e);
    }

    await dispararPixel(userPhone, userEmail, value, plan, eventId, ins?.id, savedCtwaClid, receivingPhoneNumberId);

    try {
      await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-sales-bot/notify-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ phone: userPhone, name: userName || "", email: userEmail || "", plan }),
      });
      console.log("[asaas-webhook] notificacao enviada:", userPhone);
    } catch (e) { console.error("[asaas-webhook] notify error:", e); }

    return json({ ok: true, userId, plan, endAt: endAt.toISOString() }, 200);
  } catch (e) {
    console.error("[asaas-webhook] ERROR:", e);
    alertWebhookFailure("exceção não tratada", String(e));
    return json({ ok: false, error: String(e) }, 500);
  }
});
