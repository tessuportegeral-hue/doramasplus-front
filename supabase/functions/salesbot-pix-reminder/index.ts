import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const WHATSAPP_PHONE_NUMBER_ID_8218 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_8218") || "1253472567838504";
const DEFAULT_PHONE_NUMBER_ID = WHATSAPP_PHONE_NUMBER_ID_1499;
const SITE = "www.doramasplus.com.br";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Multi-numero: resolve de qual Phone Number ID enviar pela sessao do destinatario
async function resolveSendId(to: string): Promise<string> {
  try {
    const { data } = await supabase.from("sales_bot_sessions").select("receiving_phone_number_id").eq("phone", to).maybeSingle();
    if (data?.receiving_phone_number_id) return String(data.receiving_phone_number_id);
  } catch {}
  return DEFAULT_PHONE_NUMBER_ID;
}
async function sendText(to: string, body: string) {
  const phoneId = await resolveSendId(to);
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[reminder] WA send failed ${res.status}:`, t);
    return false;
  }
  try { await supabase.from("sales_bot_messages").insert({ phone: to, direction: "out", message: body }); } catch {}
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const now = new Date();
    // 5 min sem pagar = lembrete
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: sessions, error } = await supabase
      .from("sales_bot_sessions")
      .select("phone, step, data, updated_at, reminder_sent_at")
      .eq("step", "waiting_payment")
      .is("reminder_sent_at", null)
      .lt("updated_at", fiveMinAgo)
      .gt("updated_at", twentyFourHoursAgo);

    if (error) {
      console.error("[reminder] query error:", error);
      return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[reminder] encontradas ${sessions?.length || 0} sessoes pendentes`);
    let sent = 0;

    for (const session of (sessions || [])) {
      const phone = session.phone;
      const plan = String(session.data?.plan || "");
      const orderNsu = String(session.data?.order_nsu || "");

      if (orderNsu) {
        const { data: payment } = await supabase
          .from("pix_payments")
          .select("status")
          .eq("order_nsu", orderNsu)
          .maybeSingle();

        if (payment?.status === "paid") {
          console.log(`[reminder] ${phone} ja pagou, pulando`);
          await supabase.from("sales_bot_sessions").update({ reminder_sent_at: now.toISOString() }).eq("phone", phone);
          continue;
        }
      }

      let msg = "";
      if (plan === "series") {
        msg = `Oi! 😊 Vi que você se interessou pela série por R$10,00 mas ainda não finalizou o pagamento.\n\n` +
          `Ainda quer receber? ❤️ O PIX continua válido!\n\n` +
          `Se precisar de ajuda pra pagar, só me falar que te explico! 😉`;
      } else if (plan === "quarterly") {
        msg = `Oi! 😊 Vi que você escolheu o plano Trimestral (R$47,90) mas ainda não finalizou o pagamento.\n\n` +
          `É o melhor custo-benefício! 🔥 Acesso a +2000 séries por 3 meses.\n\n` +
          `O PIX continua válido — só copiar e colar no banco! Quer ajuda? 😉`;
      } else {
        msg = `Oi! 😊 Vi que você escolheu o plano Mensal (R$16,90) mas ainda não finalizou o pagamento.\n\n` +
          `Acesso a +2000 séries te esperando! 🌟\n\n` +
          `O PIX continua válido — só copiar e colar no banco! Quer ajuda? 😉`;
      }

      const ok = await sendText(phone, msg);
      if (ok) {
        await supabase.from("sales_bot_sessions").update({ reminder_sent_at: now.toISOString() }).eq("phone", phone);
        sent++;
        console.log(`[reminder] enviado para ${phone} (${plan})`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[reminder] total enviados: ${sent}/${sessions?.length || 0}`);
    return new Response(JSON.stringify({ ok: true, checked: sessions?.length || 0, sent }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[reminder] ERROR:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
