import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const STEPS = ["choose_plan", "collect_info", "collect_email", "waiting_payment"];

async function sendText(to: string, body: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID_1499) throw new Error("WA credentials ausentes");
  const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID_1499}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`WA send failed ${res.status}: ${t}`); }
  try { await supabase.from("sales_bot_messages").insert({ phone: to, direction: "out", message: body }); } catch {}
}

serve(async () => {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() - 3 * 60 * 60 * 1000);

    const { data: sessions, error } = await supabase
      .from("sales_bot_sessions")
      .select("phone, step, data, updated_at")
      .in("step", STEPS)
      .is("data->followup2_sent", null)
      .gte("updated_at", windowStart.toISOString())
      .lte("updated_at", windowEnd.toISOString());

    if (error) { console.error("[cold-followup] query error", String(error.message)); return new Response("error", { status: 500 }); }
    if (!sessions || sessions.length === 0) { console.log("[cold-followup] nenhuma sessao elegivel"); return new Response("ok", { status: 200 }); }

    console.log(`[cold-followup] ${sessions.length} sessao(oes) elegiveis`);

    for (const sess of sessions) {
      try {
        const phone = sess.phone;
        const sessionData = sess.data || {};

        const msg =
          `Oii! \u{1F44B} Ainda tem interesse nos nossos planos?\n\n` +
          `1\u{FE0F}\u{20E3} *1 Serie* — R$10,00 (recebe aqui no WhatsApp)\n` +
          `2\u{FE0F}\u{20E3} *Mensal* — R$16,90 (acesso completo por 30 dias)\n` +
          `3\u{FE0F}\u{20E3} *Trimestral* — R$47,90 (melhor custo-beneficio!)\n\n` +
          `E so responder *1*, *2* ou *3*! \u{1F60A}`;

        await sendText(phone, msg);

        await supabase.from("sales_bot_sessions").update({
          data: { ...sessionData, followup2_sent: true },
        }).eq("phone", phone);

        console.log(`[cold-followup] enviado para ${phone}`);
      } catch (e) {
        console.error(`[cold-followup] erro ao enviar para ${sess.phone}`, String(e));
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: sessions.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[cold-followup] erro geral", String(e));
    return new Response("error", { status: 500 });
  }
});
