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
    // Busca sessoes series_sent com entre 22h e 23.5h de atraso, que ainda nao receberam upsell
    const now = new Date();
    const windowStart = new Date(now.getTime() - 23.5 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() - 22 * 60 * 60 * 1000);

    const { data: sessions, error } = await supabase
      .from("sales_bot_sessions")
      .select("phone, data, updated_at")
      .eq("step", "series_sent")
      .is("data->upsell_sent", null)
      .gte("updated_at", windowStart.toISOString())
      .lte("updated_at", windowEnd.toISOString());

    if (error) { console.error("[upsell] query error", String(error.message)); return new Response("error", { status: 500 }); }
    if (!sessions || sessions.length === 0) { console.log("[upsell] nenhuma sessao elegivel"); return new Response("ok", { status: 200 }); }

    console.log(`[upsell] ${sessions.length} sessao(oes) elegiveis`);

    for (const sess of sessions) {
      try {
        const phone = sess.phone;
        const sessionData = sess.data || {};

        const msg =
          `Oi! \u{1F60A} Curtiu a série que você recebeu?\n\n` +
          `\u{1F3AC} Sabia que temos *mais de 2000 séries* no nosso site? Você pode testar *de graça* agora mesmo!\n\n` +
          `\u{1F449} *${SITE}*\n\n` +
          `É só entrar no site e explorar o catálogo — doramas, romances, ação, tudo atualizado todo dia! \u{1F525}\n\n` +
          `Se quiser acesso completo, temos planos bem acessíveis:\n\n` +
          `2\u{FE0F}\u{20E3} *Mensal* — R$16,90 (30 dias)\n` +
          `3\u{FE0F}\u{20E3} *Trimestral* — R$47,90 (melhor custo!)\n\n` +
          `É só me responder aqui no WhatsApp com *2* ou *3* que eu gero o PIX na hora! \u{1F60A}`;

        await sendText(phone, msg);

        // Marca upsell_sent na sessao e muda step para series_upsell_sent
        await supabase.from("sales_bot_sessions").upsert({
          phone,
          step: "series_upsell_sent",
          data: { ...sessionData, upsell_sent: true },
          updated_at: new Date().toISOString(),
        }, { onConflict: "phone" });

        console.log(`[upsell] enviado para ${phone}`);
      } catch (e) {
        console.error(`[upsell] erro ao enviar para ${sess.phone}`, String(e));
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: sessions.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[upsell] erro geral", String(e));
    return new Response("error", { status: 500 });
  }
});
