// Checagem pontual (25/07): confirma se o pacer da InfinityPay
// (ver whatsapp-renewal-cron / email-renewal-reminder, deploy 24/07) resolveu
// o problema do link genérico no lembrete de renovação. Roda a query de
// link_ok vs fallback do dia e manda o resultado pro WhatsApp pessoal do
// admin — mesmo mecanismo de alerta já usado no whatsapp-sales-bot (sendRaw).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const ALERT_PHONE = "5518991504207";
const CHECK_SECRET = "dp_pacer_check_m3k7q1";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ✅ 25/07: WhatsApp texto livre só entrega se existe janela de conversa
// aberta (24h) com o número business — mesma limitação já documentada no
// disjuntor do whatsapp-sales-bot. Email é o canal confiável de verdade;
// WhatsApp fica como bônus best-effort (não falha o relatório se der erro).
async function sendEmail(text: string) {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: "🔧 DoramasPlus — Check pacer InfinityPay",
      html: `<pre style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${text}</pre>`,
    }),
  }).catch((e) => console.error("[pacer-check] email fail:", String(e)));
}

async function sendWhatsApp(text: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID_1499) return;
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID_1499}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: ALERT_PHONE, type: "text", text: { body: text } }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error(`[pacer-check] WA send failed ${res.status}: ${t}`);
    }
  } catch (e) {
    console.error("[pacer-check] WA fail:", String(e));
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-check-secret") !== CHECK_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const sql = `
    select
      kind,
      date(created_at at time zone 'America/Sao_Paulo') as dia,
      count(*) filter (where meta->>'reason' = 'sent') as enviados,
      count(*) filter (where meta->>'link' like '%doramasplus.com.br/r/%') as link_ok,
      count(*) filter (where meta->>'link' = 'www.doramasplus.com.br/plans') as fallback
    from whatsapp_renewal_logs
    where kind in ('renew_3d','renew_1d')
      and created_at at time zone 'America/Sao_Paulo' >= date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '1 day'
    group by 1,2
    order by 2 desc, 1
  `;

  const { data, error } = await supabase.rpc("exec_sql", { q: sql });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: JSON.stringify(error) }), { status: 500 });
  }

  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { rows?: Record<string, unknown>[] })?.rows)
    ? (data as { rows?: Record<string, unknown>[] }).rows!
    : [];

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const lines: string[] = [];
  let todayHasData = false;
  let worstPct = 100;

  for (const kind of ["renew_3d", "renew_1d"]) {
    const rowsForKind = rows.filter((r) => r.kind === kind);
    for (const r of rowsForKind) {
      const dia = String(r.dia);
      const enviados = Number(r.enviados || 0);
      const linkOk = Number(r.link_ok || 0);
      const fallback = Number(r.fallback || 0);
      const pct = enviados > 0 ? Math.round((linkOk / enviados) * 100) : 0;
      if (dia === today && enviados > 0) {
        todayHasData = true;
        worstPct = Math.min(worstPct, pct);
      }
      lines.push(`${kind} (${dia}): ${linkOk}/${enviados} link direto (${pct}%), ${fallback} genérico`);
    }
  }

  let verdict: string;
  if (!todayHasData) {
    verdict = "⚠️ Ainda não tem envios de hoje pra comparar (cron pode não ter rodado ainda).";
  } else if (worstPct >= 80) {
    verdict = "✅ Pacer funcionou! Taxa de link direto voltou ao normal.";
  } else {
    verdict = "❌ Pacer não resolveu — taxa de link direto ainda baixa, precisa investigar mais.";
  }

  const text = `🔧 Check pacer InfinityPay (${today})\n\n${lines.join("\n")}\n\n${verdict}\n\n(baseline 24/07 antes do fix: renew_3d 20/74=27%, renew_1d 5/69=7%)`;

  await Promise.all([sendEmail(text), sendWhatsApp(text)]);

  return new Response(JSON.stringify({ ok: true, report: text }), { status: 200 });
});
