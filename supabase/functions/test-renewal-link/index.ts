// Diagnóstico pontual (23/07): gera o link de renovação exatamente como o
// whatsapp-renewal-cron faria, pra visualizar/testar sem esperar o cron
// rodar de verdade. Só usa a conta de teste (tesagencia@gmail.com).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || "https://doramasplus.com.br";
const INFINITEPAY_HANDLE = Deno.env.get("INFINITEPAY_HANDLE") || "";
const INFINITEPAY_WEBHOOK_URL =
  Deno.env.get("INFINITEPAY_WEBHOOK_URL") || Deno.env.get("INIFITEPAY_WEBHOOK_URL") || "";
const CHECK_SECRET = "dp_test_renewal_link_p8v3";
const WHATSAPP_WEBHOOK_BASE = Deno.env.get("WHATSAPP_WEBHOOK_BASE") || "";
const ZAP_ADMIN_SECRET = Deno.env.get("ZAP_ADMIN_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendTemplate(toE164Digits: string, template: string, name: string, link: string) {
  const url = `${WHATSAPP_WEBHOOK_BASE}/send-template`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ZAP_ADMIN_SECRET ? { "x-zap-secret": ZAP_ADMIN_SECRET } : {}),
    },
    body: JSON.stringify({ to: toE164Digits, template, name, link }),
  });
  const txt = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: txt };
}

async function createShortRedirect(targetUrl: string): Promise<string | null> {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const { error } = await supabase.from("payment_redirects").insert({ token, target_url: targetUrl });
  if (error) return null;
  return token;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-check-secret") !== CHECK_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") || "";
  const plan = url.searchParams.get("plan") === "quarterly" ? "quarterly" : "monthly";

  if (!userId) return new Response(JSON.stringify({ error: "missing user_id" }), { status: 400 });
  if (!INFINITEPAY_HANDLE || !INFINITEPAY_WEBHOOK_URL) {
    return new Response(JSON.stringify({ error: "ENV InfinityPay ausente" }), { status: 400 });
  }

  const amountCents = plan === "quarterly" ? 4790 : 1690;
  const description = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrao";
  const order_nsu = `doramasplus|${userId}|${plan}|${Date.now()}`;
  const redirect_url =
    `${PUBLIC_BASE_URL}/checkout/sucesso?gateway=infinitepay&order_nsu=${encodeURIComponent(order_nsu)}&event_id=${encodeURIComponent(order_nsu)}`;

  const { data: prof } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  const userEmail = prof?.email || "no-email@local.invalid";

  const resp = await fetch("https://api.checkout.infinitepay.io/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: INFINITEPAY_HANDLE,
      order_nsu,
      webhook_url: INFINITEPAY_WEBHOOK_URL,
      redirect_url,
      items: [{ quantity: 1, price: amountCents, description }],
      customer: { email: userEmail },
    }),
  });

  const text = await resp.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}

  if (!resp.ok || !parsed?.url) {
    return new Response(JSON.stringify({ error: "InfinityPay falhou", status: resp.status, body: parsed ?? text }), { status: 400 });
  }

  try {
    await supabase.from("pix_payments").insert({
      user_id: userId,
      provider: "infinitepay",
      plan,
      amount_cents: amountCents,
      order_nsu,
      status: "pending",
      raw: parsed,
      event_id: order_nsu,
      source: "test_renewal_link",
    });
  } catch {}

  const token = await createShortRedirect(String(parsed.url));
  const shortLink = token ? `${PUBLIC_BASE_URL}/r/${token}` : null;

  const toPhone = url.searchParams.get("to_phone") || "";
  const nameParam = url.searchParams.get("name") || "amigo(a)";
  let whatsapp_send: unknown = null;
  if (toPhone && shortLink) {
    whatsapp_send = await sendTemplate(toPhone, "renovacao_urgente", nameParam, shortLink);
  }

  return new Response(
    JSON.stringify({ ok: true, real_infinitepay_url: parsed.url, short_link: shortLink, order_nsu, whatsapp_send }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
