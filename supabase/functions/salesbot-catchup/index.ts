import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const WHATSAPP_PHONE_NUMBER_ID_8218 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_8218") || "1253472567838504";
const DEFAULT_PHONE_NUMBER_ID = WHATSAPP_PHONE_NUMBER_ID_1499;
const SITE = "www.doramasplus.com.br";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const STEPS_TO_CHECK = ["series_sent", "choose_plan", "collect_info", "collect_email", "waiting_payment"];

const MESSAGES: Record<string, string> = {
  series_sent:
    `Oi! Tudo bem? \u{1F60A} Curtiu as séries? Espero que tenha gostado!\n\n` +
    `Se quiser assistir muito mais, no nosso site tem +2000 séries completas e a gente adiciona novas todo dia! \u{1F525}\n\n` +
    `Dá uma olhada: ${SITE}\n\n` +
    `Qualquer dúvida é só me chamar! \u{1F49B}`,
  choose_plan:
    `Oi! Vi que você ficou em dúvida sobre qual pacote escolher \u{1F60A}\n\n` +
    `Posso te ajudar? Responde *2* (Mensal R$16,90) ou *3* (Trimestral R$47,90) que eu te explico tudo! \u{1F49B}`,
  collect_info:
    `Oi! Falta só seu nome e email pra eu liberar seu acesso! \u{1F60A}\n\n` +
    `Me manda assim: _Nome Sobrenome / email@exemplo.com_`,
  collect_email:
    `Oi! Falta só seu nome e email pra eu liberar seu acesso! \u{1F60A}\n\n` +
    `Me manda assim: _Nome Sobrenome / email@exemplo.com_`,
  waiting_payment:
    `Oi! Vi que você ficou com o PIX em aberto... ainda quer garantir seu acesso? \u{1F60A}\n\n` +
    `O código ainda é válido! Me manda uma mensagem que eu te ajudo \u{1F49B}`,
};

// Multi-numero: resolve de qual Phone Number ID enviar pela sessao do destinatario
async function resolveSendId(to: string): Promise<string> {
  try {
    const { data } = await supabase.from("sales_bot_sessions").select("receiving_phone_number_id").eq("phone", to).maybeSingle();
    if (data?.receiving_phone_number_id) return String(data.receiving_phone_number_id);
  } catch {}
  return DEFAULT_PHONE_NUMBER_ID;
}
async function sendText(to: string, body: string): Promise<boolean> {
  const phoneId = await resolveSendId(to);
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[catchup] WA send failed ${res.status}:`, t);
    return false;
  }
  try { await supabase.from("sales_bot_messages").insert({ phone: to, direction: "out", message: body }); } catch {}
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  }

  try {
    const now = new Date();
    let sent = 0;
    let skipped = 0;

    const { data: sessions, error } = await supabase
      .from("sales_bot_sessions")
      .select("phone, step, data, updated_at")
      .in("step", STEPS_TO_CHECK)
      .is("reminder_sent_at", null);

    if (error) {
      console.error("[catchup] query error:", error);
      return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500 });
    }

    console.log(`[catchup] total sessoes encontradas: ${sessions?.length || 0}`);

    for (const session of (sessions || [])) {
      const phone: string = session.phone;
      const step: string = session.step;

      const phoneDigits = phone.replace(/\D/g, "");
      const { data: profile } = await supabase.from("profiles").select("id").eq("phone", phoneDigits).maybeSingle();
      if (profile?.id) {
        const { data: sub } = await supabase.from("subscriptions").select("status").eq("user_id", profile.id).eq("status", "active").gt("end_at", now.toISOString()).maybeSingle();
        if (sub) {
          console.log(`[catchup] ${phone} ja assinante, marcando`);
          await supabase.from("sales_bot_sessions").update({ reminder_sent_at: now.toISOString() }).eq("phone", phone);
          skipped++;
          continue;
        }
      }

      const { data: lastMsg } = await supabase
        .from("sales_bot_messages")
        .select("created_at")
        .eq("phone", phone)
        .eq("direction", "in")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastMsg?.created_at) {
        skipped++;
        continue;
      }

      const hoursAgo = (now.getTime() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60);

      if (hoursAgo < 22) {
        console.log(`[catchup] ${phone} ainda nao na janela (${hoursAgo.toFixed(1)}h)`);
        skipped++;
        continue;
      }

      const msg = MESSAGES[step];
      if (!msg) { skipped++; continue; }

      console.log(`[catchup] enviando ${phone} step=${step} (${hoursAgo.toFixed(1)}h)`);
      const ok = await sendText(phone, msg);

      if (ok) {
        const updates: Record<string, unknown> = {
          data: { ...(session.data || {}), upsell_sent: true },
          reminder_sent_at: now.toISOString(),
        };
        if (step === "series_sent") updates.step = "series_upsell_sent";
        await supabase.from("sales_bot_sessions").update(updates).eq("phone", phone);
        sent++;
      }

      await new Promise(r => setTimeout(r, 1200));
    }

    const result = { ok: true, total: sessions?.length || 0, sent, skipped };
    console.log("[catchup] resultado:", result);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[catchup] ERROR:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
