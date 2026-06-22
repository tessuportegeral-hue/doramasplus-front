import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const WHATSAPP_PHONE_NUMBER_ID_8218 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_8218") || "1253472567838504";
const DEFAULT_PHONE_NUMBER_ID = WHATSAPP_PHONE_NUMBER_ID_1499;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Steps onde faz sentido reengajar (pessoa estava no meio do fluxo de compra)
const ACTIVE_SALES_STEPS = ["choose_plan", "collect_info", "collect_email", "waiting_payment"];

function digitsOnly(v: string) { return String(v || "").replace(/\D/g, ""); }
function normalizeToE164BR(raw: string) {
  let d = digitsOnly(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

async function saveMessage(phone: string, direction: "in" | "out", message: string) {
  try { await supabase.from("sales_bot_messages").insert({ phone, direction, message }); } catch {}
}

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
  if (!WHATSAPP_TOKEN || !phoneId) throw new Error("WA credentials ausentes");
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`WA send failed ${res.status}: ${t}`); }
  await saveMessage(to, "out", body);
}

function buildFollowupMsg(step: string, plan: string): string {
  if (step === "waiting_payment") {
    return `Oii! 👋 Vi que você ainda não finalizou o pagamento do seu PIX.\n\nAinda tem interesse? Posso te ajudar com qualquer dúvida ou gerar um novo código se precisar! 😊`;
  }
  if (step === "choose_plan") {
    return `Oii! 👋 Ainda está por aqui?\n\nFico no aguardo da sua escolha:\n\n1️⃣ 1 Série por R$10,00\n2️⃣ Mensal — R$16,90\n3️⃣ Trimestral — R$47,90\n\nQualquer dúvida é só falar! 😊`;
  }
  if (step === "collect_info" || step === "collect_email") {
    return `Oii! 👋 Ainda está com interesse em finalizar seu cadastro?\n\nSó preciso do seu *nome* e *email* pra gerar seu acesso! 😊`;
  }
  return `Oii! 👋 Ainda está por aqui? Posso te ajudar com algo?`;
}

Deno.serve(async (_req) => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutos atras
    const maxCutoff = new Date(Date.now() - 60 * 60 * 1000); // nao reengaja sessoes muito antigas (1h+)

    const { data: sessions, error } = await supabase
      .from("sales_bot_sessions")
      .select("phone, step, data, updated_at")
      .in("step", ACTIVE_SALES_STEPS)
      .lt("updated_at", cutoff.toISOString())
      .gt("updated_at", maxCutoff.toISOString());

    if (error) throw error;

    let sent = 0;
    for (const session of sessions || []) {
      const sessionData = session.data || {};
      if (sessionData.followup_sent) continue; // ja mandou, nao repete

      const toE164 = normalizeToE164BR(session.phone);
      const msg = buildFollowupMsg(session.step, String(sessionData.plan || ""));

      try {
        await sendText(toE164, msg);
        await supabase.from("sales_bot_sessions").update({
          data: { ...sessionData, followup_sent: true },
        }).eq("phone", session.phone);
        sent++;
      } catch (e) {
        console.error("[followup] erro ao enviar para", session.phone, String(e));
      }
    }

    return new Response(JSON.stringify({ ok: true, checked: sessions?.length || 0, sent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sales-bot-followup] ERROR:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
