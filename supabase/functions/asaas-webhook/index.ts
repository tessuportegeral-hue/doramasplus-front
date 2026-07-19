import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditReferralIfEligible, resolvePendingReferralsForReferrer } from "../_shared/referral.ts";
import { grantSubscriptionAndProfile } from "../_shared/grant-subscription.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const DEFAULT_PASSWORD = "123456";

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

    // Pagamento fora do fluxo do salesbot: retorna 200 para nao gerar penalizacao no Asaas
    if (!externalReference) {
      console.log("[asaas-webhook] externalReference ausente, ignorando pagamento:", asaasPaymentId);
      return json({ ok: true, ignored: true, reason: "externalReference ausente" }, 200);
    }
    const parts = externalReference.split("|");
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

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-sales-bot/notify-access`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ phone: userPhone, name: "", email: "", plan: "series" }),
        });
      } catch (e) { console.error("[asaas-webhook] notify series error:", e); }

      return json({ ok: true, plan: "series", phone: userPhone }, 200);
    }

    // monthly / quarterly
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

    // libera assinatura (subscriptions primeiro, profiles so se der certo)
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

    if (!grantResult.ok) { console.error("[asaas-webhook] subscription error:", grantResult.error); return json({ ok: false, error: "erro ao liberar assinatura" }, 500); }

    // Referral - este pagamento veio via Asaas, fora dos webhooks normais
    // (InfinityPay/Stripe). Sem isso, indicacoes que passam por aqui nunca
    // creditam o indicador.
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
    return json({ ok: false, error: String(e) }, 500);
  }
});
