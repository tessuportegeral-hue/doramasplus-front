import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const SITE = "www.doramasplus.com.br";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendText(to: string, body: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID_1499) throw new Error("WA credentials ausentes");
  const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID_1499}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`WA send failed ${res.status}: ${t}`); }
  try {
    await supabase.from("sales_bot_messages").insert({ phone: to, direction: "out", message: body });
  } catch {}
}

serve(async () => {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 23.5 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() - 22 * 60 * 60 * 1000);

    const { data: sessions, error } = await supabase
      .from("sales_bot_sessions")
      .select("phone, data, updated_at")
      .eq("step", "access_sent")
      .is("data->engagement_sent", null)
      .gte("updated_at", windowStart.toISOString())
      .lte("updated_at", windowEnd.toISOString());

    if (error) { console.error("[engagement] query error", String(error.message)); return new Response("error", { status: 500 }); }
    if (!sessions || sessions.length === 0) { console.log("[engagement] nenhuma sessao elegivel"); return new Response("ok", { status: 200 }); }

    console.log(`[engagement] ${sessions.length} sessao(oes) elegiveis`);

    for (const sess of sessions) {
      try {
        const phone = sess.phone;
        const sessionData = sess.data || {};
        const email = String(sessionData.email || "");

        const emailLine = email ? `\nEntra com esse email: *${email}*\n` : `\nÉ só entrar com seu login e senha que eu te mandei.\n`;

        const msg =
          `Oi! \u{1F60A} Tudo bem?\n\n` +
          `Queria saber se você já conseguiu acessar a plataforma e curtir as séries! \u{1F4FA}\n\n` +
          `\u{1F449} *${SITE}*\n` +
          emailLine +
          `\nTá tendo dificuldade pra acessar? Fala com nosso suporte oficial:\n` +
          `\u{1F4AC} *+55 18 99679-6654*\n\n` +
          `E entra na nossa comunidade pra ficar por dentro de tudo! \u{1F447}\n` +
          `https://chat.whatsapp.com/HSG7dv1uz0FD07J5Uz2o0k`;

        await sendText(phone, msg);

        await supabase.from("sales_bot_sessions").upsert({
          phone,
          step: "access_sent",
          data: { ...sessionData, engagement_sent: true },
          updated_at: new Date().toISOString(),
        }, { onConflict: "phone" });

        console.log(`[engagement] enviado para ${phone}`);
      } catch (e) {
        console.error(`[engagement] erro ao enviar para ${sess.phone}`, String(e));
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: sessions.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[engagement] erro geral", String(e));
    return new Response("error", { status: 500 });
  }
});
