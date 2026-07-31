// Utilitário genérico (25/07): manda qualquer texto pro WhatsApp pessoal do
// admin (5518991504207) — mesmo mecanismo de alerta já usado no
// whatsapp-sales-bot (sendRaw) e no renewal-link-pacer-check. Serve pra
// qualquer relatório pontual que o admin peça pra receber por WhatsApp,
// sem precisar criar uma function nova toda vez.
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const ALERT_PHONE = "5518991504207";
const CHECK_SECRET = "dp_admin_notify_h4t8w2";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";

// ✅ 25/07: WhatsApp texto livre só entrega com janela de conversa aberta
// (24h) — mesma limitação do disjuntor do whatsapp-sales-bot. Email sempre
// vai junto como canal confiável; WhatsApp é bônus best-effort.
async function sendEmail(text: string): Promise<{ ok: boolean; status?: number; body?: unknown; reason?: string }> {
  if (!RESEND_API_KEY || !ALERT_EMAIL) {
    return { ok: false, reason: !RESEND_API_KEY ? "missing_RESEND_API_KEY" : "missing_ALERT_EMAIL" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ALERT_EMAIL],
        subject: "📋 DoramasPlus — Relatório",
        html: `<pre style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${text}</pre>`,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) console.error("[admin-notify] email rejected:", res.status, JSON.stringify(body));
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    console.error("[admin-notify] email fail:", String(e));
    return { ok: false, reason: String(e) };
  }
}

async function sendWhatsApp(text: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID_1499) return null;
  const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID_1499}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: ALERT_PHONE, type: "text", text: { body: text } }),
  });
  const responseText = await res.text().catch(() => "");
  let parsed: unknown = null;
  try { parsed = JSON.parse(responseText); } catch {}
  if (!res.ok) {
    console.error(`[admin-notify] WA send failed ${res.status}: ${responseText}`);
    return { status: res.status, body: parsed ?? responseText, ok: false };
  }
  return { status: res.status, body: parsed ?? responseText, ok: true };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-check-secret") !== CHECK_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  if (new URL(req.url).searchParams.get("whoami") === "1") {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID_1499}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), { status: 200 });
  }

  if (new URL(req.url).searchParams.get("debug_token") === "1") {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/debug_token?input_token=${WHATSAPP_TOKEN}&access_token=${WHATSAPP_TOKEN}`
    );
    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), { status: 200 });
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return new Response(JSON.stringify({ ok: false, error: "missing message" }), { status: 400 });
  }

  const [emailResult, waResult] = await Promise.all([sendEmail(message), sendWhatsApp(message)]);

  return new Response(JSON.stringify({ ok: true, email: emailResult, whatsapp: waResult }), { status: 200 });
});
