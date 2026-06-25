import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const WHATSAPP_PHONE_NUMBER_ID_8218 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_8218") || "1253472567838504";
const DEFAULT_PHONE_NUMBER_ID = WHATSAPP_PHONE_NUMBER_ID_1499;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "doramasplus_sales_verify";
const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || "https://doramasplus.com.br";
const DEFAULT_PASSWORD = "123456";
const VIP_GROUP = "https://chat.whatsapp.com/HSG7dv1uz0FD07J5Uz2o0k";
const ADMIN_EMAIL = "tessuportegeral@gmail.com";
const SUPORTE_HUMANO = "https://wa.me/5518996796654";

// ---- Rate limit / disjuntor (anti-spam + anti-abuso Asaas) ----
const ALERT_PHONE = "5518991504207";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";
const SELFTEST_KEY = "dp_alert_selftest_7gk29";
const RL_MSG_PER_MIN = 7;
const RL_BLOCK_MIN = 15;
const RL_PIX_PER_DAY = 4;
const RL_PIX_BLOCK_HOURS = 24;
const CB_MSG_PER_MIN = 80;
const CB_PIX_PER_HOUR = 100;
const CB_PAUSE_MIN = 60;

const SERIES: { name: string; link: string }[] = [
  { name: "O Amor que Deixei Escapar", link: "https://player.mediadelivery.net/play/624586/bc001156-66d6-49d2-8373-b3a25153949d" },
  { name: "Jogo do Destino", link: "https://player.mediadelivery.net/play/688480/64615a24-3f4a-424d-8fe3-1b5eb0cab035" },
  { name: "Sai da minha vida meu Primeiro amor Acabou", link: "https://player.mediadelivery.net/play/688480/f78df363-d92a-479e-a761-075086eee040" },
  { name: "Fiquei com o bebe e o coracao do bilionario", link: "https://player.mediadelivery.net/play/688480/e6532d6c-5c61-428d-be0a-a27a1ca781b1" },
  { name: "Ossos marcados pela dor", link: "https://player.mediadelivery.net/play/688480/15ca6b01-6ba5-4206-b9bf-fb28544227c0" },
  { name: "Seu marido e o rei da Tecnologia", link: "https://player.mediadelivery.net/play/688480/4548ae95-90fb-4a96-b047-3860ffb94ff6" },
  { name: "Quando o Destino assinou por Mim", link: "https://player.mediadelivery.net/play/624586/df231e2d-fc25-4e2f-a871-80cf53994745" },
  { name: "Presa pelo Odio, Livre pelo Amor", link: "https://player.mediadelivery.net/play/688480/78170734-2461-4c1c-98ed-d1088abaddb2" },
  { name: "Tirar as notas, Acertar as Contas", link: "https://player.mediadelivery.net/play/688480/0e5d9317-4218-4b6f-b616-ebd2cc80dd5f" },
];

const AD_SERIES_MAP: Record<string, string> = {
  // Conta 1499
  "23859058018740792": "Jogo do Destino",
  "23859058018750792": "O Amor que Deixei Escapar",
  "23859058018760792": "Sai da minha vida meu Primeiro amor Acabou",
  "23859254996260792": "Fiquei com o bebe e o coracao do bilionario",
  "23859254996240792": "Ossos marcados pela dor",
  "23859254996250792": "Seu marido e o rei da Tecnologia",
  // Conta 8218 - campanha original
  "120247300716450786": "Ossos marcados pela dor",
  "120247300716460786": "Seu marido e o rei da Tecnologia",
  "120247300716470786": "Fiquei com o bebe e o coracao do bilionario",
  // Conta 8218 - campanha duplicada
  "120247501781450786": "Seu marido e o rei da Tecnologia",
  "120247501781460786": "Fiquei com o bebe e o coracao do bilionario",
  "120247501781480786": "Ossos marcados pela dor",
  // Conta 8218 - nova campanha
  "120247509416850786": "Tirar as notas, Acertar as Contas",
  "120247509416860786": "Presa pelo Odio, Livre pelo Amor",
  "120247509416870786": "O Amor que Deixei Escapar",
  // Conta 1499 - nova campanha
  "23859373371630792": "Tirar as notas, Acertar as Contas",
  "23859373371650792": "Presa pelo Odio, Livre pelo Amor",
  "23859373371660792": "O Amor que Deixei Escapar",
};
const CAMPAIGN_SERIES_MAP: Record<string, string> = {
  "23858872800390792": "Quando o Destino assinou por Mim",
  "23858872800400792": "Quando o Destino assinou por Mim",
  "23858872800410792": "Quando o Destino assinou por Mim",
  "23858925078670792": "Quando o Destino assinou por Mim",
  "23858925078680792": "Quando o Destino assinou por Mim",
  "23858925078690792": "Quando o Destino assinou por Mim",
};

function norm(s: string) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }
function findSeries(name: string) {
  const n = norm(name);
  return SERIES.find(s => norm(s.name) === n) || SERIES.find(s => n && (norm(s.name).includes(n) || n.includes(norm(s.name)))) || null;
}
function identifySeriesFromReferral(ref: any): string | null {
  if (!ref || typeof ref !== "object") return null;
  const adId = String(ref.ad_id || "");
  if (adId && AD_SERIES_MAP[adId]) return AD_SERIES_MAP[adId];
  const sourceId = String(ref.source_id || "");
  if (sourceId && AD_SERIES_MAP[sourceId]) return AD_SERIES_MAP[sourceId];
  if (sourceId && CAMPAIGN_SERIES_MAP[sourceId]) return CAMPAIGN_SERIES_MAP[sourceId];
  const txt = norm(`${ref.headline || ""} ${ref.body || ""} ${ref.source_url || ""}`);
  if (txt) { for (const s of SERIES) { if (txt.includes(norm(s.name))) return s.name; } }
  return null;
}
function buildHighlightedSeriesMsg(seriesName: string): string {
  const hit = findSeries(seriesName);
  if (!hit) return buildGenericSeriesMsg();
  const others = SERIES.filter(s => norm(s.name) !== norm(hit.name));
  let msg = `🎉 Aqui esta a serie que voce pediu! 😊\n\n` +
    `👉 *${hit.name}*\n${hit.link}\n\n` +
    `✨ E de bonus, separei mais essas pra voce:\n\n`;
  others.forEach((s, i) => { msg += `${i + 1}️⃣ *${s.name}*\n👉 ${s.link}\n\n`; });
  msg += `📺 Quer assistir mais de 2000 series + atualizacoes diarias? Acesse: www.doramasplus.com.br`;
  return msg;
}
function buildGenericSeriesMsg(): string {
  let msg = `🎉 Aqui estao suas series! Aproveite! 😊\n\n`;
  for (let i = 0; i < 6; i++) { msg += `${i + 1}️⃣ *${SERIES[i].name}*\n👉 ${SERIES[i].link}\n\n`; }
  msg += `✨ *Bonus:*\n\n`;
  for (let i = 6; i < SERIES.length; i++) { msg += `⭐ *${SERIES[i].name}*\n👉 ${SERIES[i].link}\n\n`; }
  msg += `📺 Quer assistir mais de 2000 series + atualizacoes diarias? Acesse: www.doramasplus.com.br`;
  return msg;
}
function buildAnuncioStarMsg(seriesName: string): string {
  const hit = findSeries(seriesName);
  if (!hit) return "";
  return `📢 *AQUI ESTA A SERIE DO ANUNCIO:*\n\n⭐⭐⭐ *${hit.name}* ⭐⭐⭐\n\n👉 ${hit.link}\n\n⬆️ Clique nesse link acima!`;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function getAsaasKey() { return Deno.env.get("ASAAS_API_KEY") || ""; }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function digitsOnly(v: string) { return String(v || "").replace(/\D/g, ""); }
function normalizeToE164BR(raw: string) {
  let d = digitsOnly(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}
function jsonRes(status: number, obj: unknown) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function generateFakeEmail(phone: string) { return `${digitsOnly(phone)}@doramasplus.com`.toLowerCase(); }
function generateFakeCpf(): string {
  const n = () => Math.floor(Math.random() * 9) + 1;
  const d = [n(),n(),n(),n(),n(),n(),n(),n(),n()];
  let s = d.slice(0,9).reduce((a,v,i)=>a+v*(10-i),0);
  let d1 = 11-(s%11); if(d1>=10)d1=0; d.push(d1);
  s = d.slice(0,10).reduce((a,v,i)=>a+v*(11-i),0);
  let d2 = 11-(s%11); if(d2>=10)d2=0; d.push(d2);
  return d.join("");
}
async function saveMessage(phone: string, direction: "in"|"out", message: string) {
  try { await supabase.from("sales_bot_messages").insert({ phone, direction, message }); } catch {}
}

// ====================== RATE LIMIT / DISJUNTOR ======================
async function sendRaw(to: string, body: string, phoneId: string) {
  if (!WHATSAPP_TOKEN||!phoneId) throw new Error("WA credentials ausentes");
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`,{
    method:"POST",
    headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{body}}),
  });
  if (!res.ok){const t=await res.text().catch(()=>"");throw new Error(`WA send failed ${res.status}: ${t}`);}
}
async function tripAlert(reason: string) {
  const text = `DISJUNTOR ACIONADO no bot DoramasPlus.\n\n${reason}\n\nBot pausado por ${CB_PAUSE_MIN} min.`;
  try {
    if (RESEND_API_KEY && ALERT_EMAIL) {
      await fetch("https://api.resend.com/emails", {
        method:"POST",
        headers:{ "Content-Type":"application/json", Authorization:`Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: FROM_EMAIL, to: [ALERT_EMAIL], subject: "🚨 DoramasPlus — DISJUNTOR ACIONADO", html: `<pre style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${text}</pre>` }),
      });
    }
  } catch (e) { console.error("[alert email fail]", String(e)); }
  const ids = [WHATSAPP_PHONE_NUMBER_ID_1499, WHATSAPP_PHONE_NUMBER_ID_8218].filter(Boolean) as string[];
  for (const id of ids) {
    try { await sendRaw(ALERT_PHONE, `🚨 ${text}`, id); break; } catch (e) { console.error("[alert wa fail]", id, String(e)); }
  }
}
async function isNumberBlocked(phone: string): Promise<boolean> {
  try {
    const { data } = await supabase.from("salesbot_rate_limit").select("blocked_until,win_start,msg_count").eq("phone",phone).maybeSingle();
    if (!data) return false;
    if (data.blocked_until && new Date(data.blocked_until).getTime() > Date.now()) return true;
    if (data.win_start && (Date.now()-new Date(data.win_start).getTime() < 60000) && (data.msg_count||0) >= RL_MSG_PER_MIN) {
      await supabase.from("salesbot_rate_limit").upsert({ phone, blocked_until: new Date(Date.now()+RL_BLOCK_MIN*60000).toISOString() }, { onConflict:"phone" });
      return true;
    }
    return false;
  } catch { return false; }
}
async function bumpOutbound(phone: string) {
  try {
    const now = Date.now();
    const { data } = await supabase.from("salesbot_rate_limit").select("win_start,msg_count").eq("phone",phone).maybeSingle();
    let start = data?.win_start ? new Date(data.win_start).getTime() : 0;
    let count = data?.msg_count || 0;
    if (!start || now-start >= 60000) { start = now; count = 0; }
    count += 1;
    await supabase.from("salesbot_rate_limit").upsert({ phone, win_start: new Date(start).toISOString(), msg_count: count }, { onConflict:"phone" });
  } catch {}
}
async function cbAllowMsg(): Promise<boolean> {
  try {
    const now = Date.now();
    const { data } = await supabase.from("salesbot_circuit").select("*").eq("id",1).maybeSingle();
    const row:any = data || { id:1 };
    if (row.paused_until && new Date(row.paused_until).getTime() > now) return false;
    let start = row.min_start ? new Date(row.min_start).getTime() : 0;
    let count = row.min_count || 0;
    if (!start || now-start >= 60000) { start = now; count = 0; }
    count += 1;
    if (count > CB_MSG_PER_MIN) {
      await supabase.from("salesbot_circuit").upsert({ id:1, min_start:new Date(start).toISOString(), min_count:count, paused_until:new Date(now+CB_PAUSE_MIN*60000).toISOString(), last_alert_at:new Date(now).toISOString() }, { onConflict:"id" });
      await tripAlert(`Volume anormal: ${count} mensagens em 1 min (limite ${CB_MSG_PER_MIN}).`);
      return false;
    }
    await supabase.from("salesbot_circuit").upsert({ id:1, min_start:new Date(start).toISOString(), min_count:count }, { onConflict:"id" });
    return true;
  } catch { return true; }
}
async function cbAllowPix(): Promise<boolean> {
  try {
    const now = Date.now();
    const { data } = await supabase.from("salesbot_circuit").select("*").eq("id",1).maybeSingle();
    const row:any = data || { id:1 };
    if (row.paused_until && new Date(row.paused_until).getTime() > now) return false;
    let start = row.hour_start ? new Date(row.hour_start).getTime() : 0;
    let count = row.pix_hour_count || 0;
    if (!start || now-start >= 3600000) { start = now; count = 0; }
    count += 1;
    if (count > CB_PIX_PER_HOUR) {
      await supabase.from("salesbot_circuit").upsert({ id:1, hour_start:new Date(start).toISOString(), pix_hour_count:count, paused_until:new Date(now+CB_PAUSE_MIN*60000).toISOString(), last_alert_at:new Date(now).toISOString() }, { onConflict:"id" });
      await tripAlert(`Volume anormal de PIX: ${count} em 1 hora (limite ${CB_PIX_PER_HOUR}).`);
      return false;
    }
    await supabase.from("salesbot_circuit").upsert({ id:1, hour_start:new Date(start).toISOString(), pix_hour_count:count }, { onConflict:"id" });
    return true;
  } catch { return true; }
}
async function pixDayAllow(phone: string): Promise<boolean> {
  try {
    const today = new Date().toISOString().slice(0,10);
    const { data } = await supabase.from("salesbot_rate_limit").select("pix_day,pix_count").eq("phone",phone).maybeSingle();
    let day = data?.pix_day || null;
    let count = data?.pix_count || 0;
    if (day !== today) { day = today; count = 0; }
    if (count >= RL_PIX_PER_DAY) {
      await supabase.from("salesbot_rate_limit").upsert({ phone, blocked_until: new Date(Date.now()+RL_PIX_BLOCK_HOURS*3600000).toISOString() }, { onConflict:"phone" });
      return false;
    }
    count += 1;
    await supabase.from("salesbot_rate_limit").upsert({ phone, pix_day:day, pix_count:count }, { onConflict:"phone" });
    return true;
  } catch { return true; }
}
// ====================================================================

function detectOption(msg: string): "series"|"monthly"|"quarterly"|null {
  const m = norm(msg);
  if (m==="1"||m.includes("serie")||m.includes("drive")||m.includes("10")||m.includes("avuls")) return "series";
  if (m==="2"||m.includes("mensal")||m.includes("1 mes")||m.includes("um mes")||m.includes("16")||m.includes("month")||m.includes("30 dia")) return "monthly";
  if (m==="3"||m.includes("trimes")||m.includes("3 mes")||m.includes("tres mes")||m.includes("47")||m.includes("90 dia")||m.includes("anual")||m.includes("melhor")||m.includes("mais barato")) return "quarterly";
  return null;
}
function detectComplaint(msg: string): "nome"|"email"|null {
  const m = norm(msg);
  if (m.includes("nome")&&(m.includes("errado")||m.includes("errou")||m.includes("incorreto")||m.includes("diferente")||m.includes("nao e")||m.includes("nao ta")||m.includes("nao esta"))) return "nome";
  if (m.includes("email")&&(m.includes("errado")||m.includes("errou")||m.includes("incorreto")||m.includes("diferente")||m.includes("nao e")||m.includes("nao ta")||m.includes("nao esta")||m.includes("nao reconhec")||m.includes("nao achei"))) return "email";
  return null;
}
function detectPixProblem(msg: string): boolean {
  const m = norm(msg);

  const temPalavraChave =
    m.includes("pix") || m.includes("codigo") || m.includes("codig") ||
    m.includes("qr") || m.includes("pagamento") || m.includes("pagar") ||
    m.includes("pago") || m.includes("paguei") || m.includes("chave") ||
    m.includes("copia") || m.includes("cola") || m.includes("copiar") ||
    m.includes("colar") || m.includes("tentei") || m.includes("tentando") ||
    m.includes("banco") || m.includes("transfere") || m.includes("transferi") ||
    m.includes("valor") || m.includes("boleto") || m.includes("copiando") ||
    m.includes("colando") || m.includes("leitura") || m.includes("escane") ||
    m.includes("scanner") || m.includes("ler") || m.includes("reconhece");

  const temProblema =
    m.includes("invalido") || m.includes("invalida") ||
    m.includes("nao funciona") || m.includes("nao ta") || m.includes("nao esta") ||
    m.includes("nao funcionou") || m.includes("erro") || m.includes("expirou") ||
    m.includes("venceu") || m.includes("expirado") || m.includes("vencido") ||
    m.includes("nao aceita") || m.includes("nao consigo") || m.includes("n consigo") ||
    m.includes("deu erro") || m.includes("recusado") || m.includes("recusando") ||
    m.includes("nao passou") || m.includes("nao reconhec") || m.includes("nao acho") ||
    m.includes("nao aparece") || m.includes("onde colo") || m.includes("como uso") ||
    m.includes("como pago") || m.includes("como faco") || m.includes("nao sei") ||
    m.includes("como colo") || m.includes("nao deu") || m.includes("n deu") ||
    m.includes("nao vai") || m.includes("n vai") || m.includes("nao da") ||
    m.includes("nao to") || m.includes("nao to conseguindo") ||
    m.includes("nao estou conseguindo") || m.includes("nao to conseguindo") ||
    m.includes("deu ruim") || m.includes("deu problema") || m.includes("deu errado") ||
    m.includes("nao abriu") || m.includes("nao abre") ||
    m.includes("varias vezes") || m.includes("ja tentei") || m.includes("tentei varia") ||
    m.includes("nao foi") || m.includes("impossivel") || m.includes("nao processou") ||
    m.includes("problema") || m.includes("dificuldade") || m.includes("nao funcionando") ||
    m.includes("ta dando erro") || m.includes("continua") || m.includes("ainda nao") ||
    m.includes("nao concluiu") || m.includes("nao finalizou") || m.includes("nao deu certo") ||
    m.includes("nao ta dando") || m.includes("nao carregou") || m.includes("nao carrega") ||
    m.includes("n ta") || m.includes("cadê") || m.includes("cade") || m.includes("sumiu") ||
    m.includes("nao funcinou") || m.includes("nao fuinciona") ||
    m.includes("nao to vendo") || m.includes("nao to achando") ||
    m.includes("nao to entendendo") || m.includes("nao entendi") ||
    m.includes("nao entendo") || m.includes("como faz") || m.includes("como faco") ||
    m.includes("como fazo") || m.includes("nao sei usar") || m.includes("nao sei pagar") ||
    m.includes("nao sei como") || m.includes("me ajuda") || m.includes("me ajude") ||
    m.includes("nao consigo pagar") || m.includes("nao consegui pagar") ||
    m.includes("recusou") || m.includes("bloqueado") || m.includes("bloqueou") ||
    m.includes("nao aceitou") || m.includes("deu negado") || m.includes("negado") ||
    m.includes("nao passei") || m.includes("nao completou") || m.includes("nao completei");

  if (temPalavraChave && temProblema) return true;

  // Frases isoladas que no contexto de waiting_payment indicam claramente problema com pagamento
  const frasesIsoladas = [
    "nao consigo pagar", "nao to conseguindo pagar", "nao estou conseguindo pagar",
    "continua dando erro", "ainda nao consegui", "to sem conseguir pagar",
    "nao ta funcionando", "nao funciona", "ta dando erro", "deu erro",
    "nao da pra pagar", "nao consigo fazer o pix", "pix nao funciona",
    "pix nao ta funcionando", "nao consigo fazer", "n consigo fazer",
    "nao to conseguindo", "tentei e nao deu", "tentei mas nao deu",
    "tentei mas deu erro", "ja tentei varias vezes", "ja tentei de tudo",
    "nao ta dando", "nao da", "nao deu", "deu ruim", "deu problema",
    "nao sei fazer", "nao sei como faz", "me explica como faz",
    "como que faz", "como faz pra pagar", "como faz o pix",
    "como faz pra fazer o pix", "como que eu pago", "como pago",
    "como eu faco", "como eu pago", "onde eu colo", "onde coloco",
    "nao to achando onde colar", "onde fica o pix copia e cola",
    "nao acho o pix copia e cola", "banco nao aceita", "meu banco nao aceita",
    "meu banco nao reconhece", "o banco nao aceita", "banco nao reconhece",
    "invalido", "invalida", "codigo invalido", "chave invalida",
    "codigo expirado", "pix expirado", "codigo vencido", "pix vencido",
    "recusado", "recusou", "negado", "deu negado",
    "acho que e o banco", "e o banco", "problema no banco", "meu banco nao deixa",
    "o banco nao deixa", "banco nao ta deixando", "banco nao ta aceitando",
    "banco ta recusando", "banco ta bloqueando",
    "nao esta dando certo", "nao ta dando certo", "nao deu certo",
    "nao funcionou", "nao funcionando", "nao funciona",
    "nao to conseguindo", "nao estou conseguindo",
    "nao to conseguindo pagar", "nao estou conseguindo pagar",
    "dando erro", "deu erro", "deu problema",
    "nao aceita", "nao aceitou", "nao passou",
    "nao consigo", "n consigo",
  ];

  return frasesIsoladas.some(f => m.includes(f));
}
function looksLikeName(text: string): boolean {
  if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length<1||words.length>4) return false;
  return words.every(w=>/^[a-zA-ZÀ-ÿ]+$/.test(w));
}
function detectPlanChange(msg: string): "series"|"monthly"|"quarterly"|"menu"|null {
  const m = norm(msg);
  if (m==="1"||m==="10"||m.includes("serie")||m.includes("avuls")||m.includes("opcao 1")||m.includes("a de 10")) return "series";
  if (m==="3"||m.includes("trimes")||m.includes("opcao 3")||m.includes("tres mes")||m.includes("3 mes")||m.includes("anual")) return "quarterly";
  if (m==="2"||m.includes("mensal")||m.includes("opcao 2")||m.includes("um mes")||m.includes("1 mes")) return "monthly";
  if (m.includes("cancel")||m.includes("voltar")||m.includes("desist")||m.includes("muda")||m.includes("troca")||m.includes("arrepend")||m.includes("outro plano")||m.includes("outra opcao")||m.includes("menu")) return "menu";
  return null;
}
function wantsSeriesAgain(msg: string): boolean {
  const m = norm(msg);
  return m.includes("serie")||m.includes("dorama")||m.includes("anuncio")||m.includes("novela")||m.includes("qual o nome")||m.includes("que serie")||m.includes("qual serie");
}
async function resolveSendId(to: string, fromId?: string|null): Promise<string> {
  if (fromId) return fromId;
  try {
    const { data } = await supabase.from("sales_bot_sessions").select("receiving_phone_number_id").eq("phone", to).maybeSingle();
    if (data?.receiving_phone_number_id) return String(data.receiving_phone_number_id);
  } catch {}
  return DEFAULT_PHONE_NUMBER_ID;
}
async function sendText(to: string, body: string, fromId?: string|null) {
  const phoneId = await resolveSendId(to, fromId);
  if (!WHATSAPP_TOKEN||!phoneId) throw new Error("WA credentials ausentes");
  if (!(await cbAllowMsg())) return;
  await bumpOutbound(to);
  await sendRaw(to, body, phoneId);
  await saveMessage(to,"out",body);
}
async function getOrCreateSession(phone: string, receivingId?: string|null) {
  const {data,error}=await supabase.from("sales_bot_sessions").select("*").eq("phone",phone).maybeSingle();
  if(error)throw error;
  if(data){
    if(receivingId && !data.receiving_phone_number_id){
      try{ await supabase.from("sales_bot_sessions").update({receiving_phone_number_id:receivingId}).eq("phone",phone); }catch{}
      data.receiving_phone_number_id = receivingId;
    }
    return data;
  }
  const {data:c,error:e2}=await supabase.from("sales_bot_sessions").insert({phone,step:"start",data:{},receiving_phone_number_id:receivingId||null}).select("*").single();
  if(e2)throw e2;
  return c;
}
async function getSession(phone: string) {
  const {data}=await supabase.from("sales_bot_sessions").select("*").eq("phone",phone).maybeSingle();
  return data||null;
}
async function updateSession(phone: string, step: string, data: Record<string,unknown>) {
  await supabase.from("sales_bot_sessions").upsert({phone,step,data,updated_at:new Date().toISOString()},{onConflict:"phone"});
}
async function checkExistingUser(phoneE164: string) {
  const digits=digitsOnly(phoneE164);
  const {data:profile}=await supabase.from("profiles").select("id,name,email").eq("phone",digits).maybeSingle();
  if(!profile)return null;
  const {data:sub}=await supabase.from("subscriptions").select("status,end_at").eq("user_id",profile.id).eq("status","active").gt("end_at",new Date().toISOString()).maybeSingle();
  return {profile,subscription:sub};
}
async function createUserAccount(name: string, phone: string, email?: string) {
  const digits=digitsOnly(phone);
  const finalEmail=email||generateFakeEmail(digits);
  const {data:created,error}=await supabase.auth.admin.createUser({email:finalEmail,password:DEFAULT_PASSWORD,email_confirm:true,user_metadata:{name,phone:digits}});
  if(error){
    const m=String(error.message||"").toLowerCase();
    if(m.includes("already")||m.includes("exists")||m.includes("registered")){
      const {data:prof}=await supabase.from("profiles").select("id").eq("email",finalEmail).maybeSingle();
      const existingId=prof?.id||null;
      if(existingId){
        try{await supabase.from("profiles").update({phone:digits}).eq("id",existingId);}catch{}
        try{await supabase.auth.admin.updateUserById(existingId,{password:DEFAULT_PASSWORD});}catch{}
        return{exists:true,userId:existingId,email:finalEmail};
      }
      return{exists:true,email:finalEmail};
    }
    throw error;
  }
  const userId=created?.user?.id;
  if(!userId)throw new Error("no_user_id");
  await supabase.from("profiles").upsert({id:userId,name,phone:digits,email:finalEmail},{onConflict:"id"});
  return{exists:false,userId,email:finalEmail};
}
async function createAsaasPix(userEmail: string, userName: string, plan: "monthly"|"quarterly"|"series", phone: string, extra?: Record<string,unknown>) {
  const key=getAsaasKey();
  const amountCents=plan==="quarterly"?4790:plan==="series"?1000:1690;
  const amount=amountCents/100;
  const externalReference=`salesbot_asaas|${digitsOnly(phone)}|${plan}|${Date.now()}`;
  const description=plan==="quarterly"?"DoramasPlus Trimestral":plan==="series"?"DoramasPlus 1 Serie":"DoramasPlus Mensal";
  const fakeCpf=generateFakeCpf();
  let customerId:string|null=null;
  try{
    const r=await fetch(`https://api.asaas.com/v3/customers?email=${encodeURIComponent(userEmail)}`,{headers:{"access_token":key}});
    const d=await r.json().catch(()=>({}));
    if(d?.data?.[0]?.id)customerId=d.data[0].id;
  }catch{}
  if(!customerId){
    const r=await fetch("https://api.asaas.com/v3/customers",{method:"POST",headers:{"access_token":key,"Content-Type":"application/json"},body:JSON.stringify({name:userName||"Cliente DoramasPlus",email:userEmail,cpfCnpj:fakeCpf,notificationDisabled:true})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(`Asaas customer error ${r.status}: ${JSON.stringify(d)}`);
    customerId=d?.id||null;
  }
  if(!customerId)throw new Error("Nao foi possivel criar cliente no Asaas");
  try{await fetch(`https://api.asaas.com/v3/customers/${customerId}`,{method:"PUT",headers:{"access_token":key,"Content-Type":"application/json"},body:JSON.stringify({notificationDisabled:true})});}catch{}
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
  const dueDate=tomorrow.toISOString().split("T")[0];
  const r2=await fetch("https://api.asaas.com/v3/payments",{method:"POST",headers:{"access_token":key,"Content-Type":"application/json"},body:JSON.stringify({customer:customerId,billingType:"PIX",value:amount,dueDate,description,externalReference})});
  const d2=await r2.json().catch(()=>({}));
  if(!r2.ok)throw new Error(`Asaas charge error ${r2.status}: ${JSON.stringify(d2)}`);
  const paymentId=d2?.id;
  if(!paymentId)throw new Error("Asaas nao retornou payment id");
  const r3=await fetch(`https://api.asaas.com/v3/payments/${paymentId}/pixQrCode`,{headers:{"access_token":key}});
  const d3=await r3.json().catch(()=>({}));
  const copyPaste=d3?.payload||null;
  if(!copyPaste)throw new Error(`PIX payload vazio: ${JSON.stringify(d3)}`);
  try{await supabase.from("pix_payments").insert({provider:"asaas",plan,amount_cents:amountCents,order_nsu:externalReference,status:"pending",raw:d2,source:"whatsapp_sales_bot",...(extra||{})});}catch{}
  return{copyPaste,externalReference,paymentId};
}
function buildAccessMsg(email: string): string {
  return `🎉 Acesso liberado com sucesso!\nSeu cadastro na DoramasPlus ja esta ativo ✅\n⏳ Acesso valido por 30 dias\n\n📱 Acesse agora:\n👉 ${PUBLIC_BASE_URL}\n\nAperta em *Entrar* (no topo da tela) e usa os dados abaixo:\n\n👤 Login: ${email}\n🔑 Senha: ${DEFAULT_PASSWORD}\n\nDepois e so apertar em *Entrar* e ta dentro! 🔓\n\n🔔 Entre na nossa comunidade para receber novos doramas e avisos:\n${VIP_GROUP}\n\n📲 *Suporte oficial:* (18) 99679-6654\n\nQualquer duvida e so me chamar 😊\n*Ah, e adiciona meu numero pra voce ficar por dentro das novidades*`;
}
function buildPresenteMsg(seriesName: string): string {
  const hit = findSeries(seriesName);
  if (!hit) return "";
  return `🎁 De presente especial, aqui esta a serie que voce viu no anuncio:\n\n👉 *${hit.name}*\n${hit.link}\n\nAproveite! 😊`;
}
async function sendAccessHelp(to: string, email: string) {
  await sendText(to,`Vou te ajudar a entrar! 😊\n\n👉 ${PUBLIC_BASE_URL}/login\n\nCole o email e a senha que vou te mandar nas proximas mensagens:`);
  await sendText(to,email);
  await sendText(to,DEFAULT_PASSWORD);
}

async function gerarPixSeries(fromE164: string, sessionData: any, receivingPhoneNumberId?: string|null) {
  if (!(await cbAllowPix())) return;
  if (!(await pixDayAllow(fromE164))) return;
  const fakeEmail = generateFakeEmail(fromE164);
  const idSeries = String(sessionData.identified_series || "");
  let pix: any = null;
  try {
    pix = await createAsaasPix(fakeEmail, "Cliente", "series", fromE164, {
      identified_series: idSeries || null,
      ctwa_clid: sessionData.ctwa_clid || null,
      ad_source_id: sessionData.ad_source_id || null,
      receiving_phone_number_id: receivingPhoneNumberId || null,
    });
  } catch(e) {
    console.error("[asaas pix series]", String(e));
    await sendText(fromE164, `Houve um erro ao gerar o PIX 😅 Tente novamente ou fale com o suporte: ${SUPORTE_HUMANO}`);
    return;
  }
  const intro = idSeries
    ? `👌 Otima escolha! A serie do anuncio por apenas *R$10,00*!`
    : `👌 Otima escolha! Uma serie incrivel por apenas *R$10,00*!`;
  await sendText(fromE164,
    `${intro}\n\n` +
    `⬇️ Na *proxima mensagem* esta o codigo PIX.\n\n` +
    `Segure e toque em *Copiar* — cole no *PIX Copia e Cola* do seu banco.\n\n` +
    `⏳ Assim que confirmar, mando sua serie automaticamente! ✅`
  );
  await sendText(fromE164, pix.copyPaste);
  await updateSession(fromE164, "waiting_payment", { ...sessionData, plan: "series", order_nsu: pix.externalReference, pix_payload: pix.copyPaste });
}

async function processMessage(fromE164: string, messageText: string, displayName: string|null, referral: any, receivingId?: string|null) {
  if (await isNumberBlocked(fromE164)) return;
  await saveMessage(fromE164,"in",messageText);
  const session=await getOrCreateSession(fromE164, receivingId);
  const step=session.step||"start";
  let sessionData=session.data||{};

  if (referral && typeof referral === "object") {
    const sid = identifySeriesFromReferral(referral);
    const patch: Record<string,unknown> = {};
    if (sid && !sessionData.identified_series) patch.identified_series = sid;
    if (referral.ctwa_clid && !sessionData.ctwa_clid) patch.ctwa_clid = referral.ctwa_clid;
    if (referral.source_id && !sessionData.ad_source_id) patch.ad_source_id = referral.source_id;
    if (Object.keys(patch).length) { sessionData = { ...sessionData, ...patch }; try { await updateSession(fromE164, step, sessionData); } catch {} }
  }

  const msg=messageText.trim().toLowerCase();
  const receivingPhoneNumberId: string|null = session.receiving_phone_number_id || null;

  if(step==="waiting_payment"||step==="access_sent"){
    const complaint=detectComplaint(msg);
    const email=String(sessionData.email||"");
    if(complaint==="nome"){await sendText(fromE164,`Sem problema! 😊 O nome e so interno.`);if(email)await sendAccessHelp(fromE164,email);return;}
    if(complaint==="email"){await sendText(fromE164,`Sem estresse! 😊 O email funciona normalmente.`);if(email)await sendAccessHelp(fromE164,email);return;}
  }

  if((step==="access_sent"||step==="series_sent"||step==="support"||step==="support_detail")&&wantsSeriesAgain(msg)){
    const idSeries=await resolveIdentifiedSeries(fromE164,session);
    if(idSeries&&findSeries(idSeries)){
      const star=buildAnuncioStarMsg(idSeries);
      if(star)await sendText(fromE164,star);
      await sendText(fromE164,buildHighlightedSeriesMsg(idSeries));
    } else {
      await sendText(fromE164,buildGenericSeriesMsg());
    }
    return;
  }

  if(step==="collect_info"||step==="collect_email"||step==="waiting_payment"){
    const change=detectPlanChange(msg);
    if(change==="series"){await gerarPixSeries(fromE164,sessionData,receivingPhoneNumberId);return;}
    if(change==="menu"){
      await sendText(fromE164,`Sem problema! 😊 Qual voce prefere?\n\n1️⃣ *1 Serie (a do anuncio) por R$10,00* (recebe aqui no WhatsApp)\n2️⃣ *Mensal* — R$16,90\n3️⃣ *Trimestral* — R$47,90\n\nResponda *1*, *2* ou *3*!`);
      await updateSession(fromE164,"choose_plan",sessionData);
      return;
    }
    if((change==="monthly"||change==="quarterly")&&change!==String(sessionData.plan||"")){
      const email=String(sessionData.email||"");
      const name=String(sessionData.name||"");
      if(email&&name){
        await finalizarCadastro(fromE164,name,email,{...sessionData,plan:change},receivingPhoneNumberId);
      } else {
        const lbl=change==="quarterly"?"Trimestral (R$47,90)":"Mensal (R$16,90)";
        await sendText(fromE164,`Perfeito, vamos de ${lbl}! 😊\n\nMe passa seu *nome* e *email* pra eu criar sua conta:\n\nExemplo: _Joao Silva / joao@gmail.com_`);
        await updateSession(fromE164,"collect_info",{...sessionData,plan:change});
      }
      return;
    }
  }

  if(step==="start"||step==="menu"){
    const existing=await checkExistingUser(fromE164);
    if(existing?.subscription){
      const name=existing.profile.name||displayName||"";
      await sendText(fromE164,`Oi${name?" "+name:""}! 😊 Voce ja tem assinatura ativa!\n\nAcesse: ${PUBLIC_BASE_URL}\n\nPrecisa de ajuda?`);
      await updateSession(fromE164,"support",{...sessionData,existing:true,email:existing.profile.email});
      return;
    }
    if(existing&&!existing.subscription){
      const name=existing.profile.name||displayName||"";
      await sendText(fromE164,`Oi${name?" "+name:""}! 😊 Encontrei sua conta aqui.\n\nSua assinatura venceu, mas e facil renovar!\n\n1️⃣ 1 Serie — R$10,00\n2️⃣ Mensal — R$16,90\n3️⃣ Trimestral — R$47,90\n\nResponda *1*, *2* ou *3*!`);
      await updateSession(fromE164,"choose_plan",{...sessionData,email:existing.profile.email,is_renewal:true});
      return;
    }
    await sendText(fromE164,
      `Oiie! Tudo bem? 🫰\nMuito Prazer, me chamo Stefano!\nFundador do www.doramasplus.com.br\n\n🚨 Promocao valida somente HOJE\n\nE sim temos a serie do anuncio que voce acabou de ver e muito mais!!!\n\n📦 Escolha seu pacote:\n\n1️⃣ *1 Serie (a do anuncio) por R$10,00* (voce recebe aqui no WhatsApp)\n2️⃣ *1 MES no APP* — R$16,90 (acesso completo)\n3️⃣ *TRIMESTRAL no APP* — R$47,90 (melhor custo-beneficio!)\n\nResponda *1*, *2* ou *3*!`
    );
    await updateSession(fromE164,"choose_plan",{...sessionData,is_renewal:false});
    return;
  }

  if(step==="choose_plan"){
    const option=detectOption(msg);
    if(!option){await sendText(fromE164,`Responde *1* (1 Serie R$10), *2* (Mensal R$16,90) ou *3* (Trimestral R$47,90) 😊`);return;}
    if(option==="series"){
      await gerarPixSeries(fromE164, sessionData, receivingPhoneNumberId);
    } else {
      await sendText(fromE164,`Otimo! 😊\n\nMe passa seu *nome* e *email* pra eu criar sua conta:\n\nExemplo: _Joao Silva / joao@gmail.com_`);
      await updateSession(fromE164,"collect_info",{...sessionData,plan:option});
    }
    return;
  }

  if(step==="collect_info"){
    const emailMatch=messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const email=emailMatch?emailMatch[0].toLowerCase():null;
    if(!email&&looksLikeName(messageText)){
      const name=messageText.trim().split(/\s+/).filter(Boolean).map((w:string)=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
      await updateSession(fromE164,"collect_email",{...sessionData,name});
      await sendText(fromE164,`Que nome lindo, ${name}! 😊\n\nE seu *email*?`);
      return;
    }
    if(!email){await sendText(fromE164,`Nao consegui identificar seu email 😅\n\nMe manda assim: *Nome Sobrenome / email@exemplo.com*`);return;}
    const nameRaw=messageText.replace(emailMatch?.[0]||"","").replace(/[\/,|\-]/g," ").trim();
    const name=nameRaw.split(/\s+/).filter(Boolean).slice(0,3).map((w:string)=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ")||"Cliente";
    await finalizarCadastro(fromE164,name,email,sessionData,receivingPhoneNumberId);
    return;
  }

  if(step==="collect_email"){
    const emailMatch=messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const email=emailMatch?emailMatch[0].toLowerCase():null;
    if(!email){await sendText(fromE164,`Hmm, nao identifiquei um email valido 😅\n\nMe manda assim: _seuemail@gmail.com_`);return;}
    const name=String(sessionData.name||displayName||"Cliente");
    await finalizarCadastro(fromE164,name,email,sessionData,receivingPhoneNumberId);
    return;
  }

  if(step==="waiting_payment"){
    const isComprovante = msg==="image"||msg==="document"||msg==="sticker";
    if(isComprovante){
      const idSeries=String(sessionData.identified_series||"");
      const planAtual=String(sessionData.plan||"");
      let suporteMsg=
        `Obrigado por enviar! 😊\n\n`+
        `Para liberar seu acesso, encaminha esse comprovante direto pro nosso suporte:\n\n`+
        `📲 *WhatsApp Suporte:* (18) 99679-6654\n\n`;
      if(planAtual==="series"&&idSeries){
        suporteMsg+=`⚠️ *Ja menciona pro suporte o nome da serie que voce quer:*\n\n👉 *${idSeries}*\n\n`;
      }
      suporteMsg+=`Eles validam e liberam na hora! 🚀`;
      await sendText(fromE164, suporteMsg);
      return;
    }
    if(detectPixProblem(msg)){
      await sendText(fromE164,
        `Sem estresse! 😊 Tenta pagar por essa chave PIX (CNPJ):\n\n` +
        `⬇️ *Copia a chave abaixo e cola no seu banco:*`
      );
      await sendText(fromE164, `66108496000120`);
      await sendText(fromE164,
        `✅ Apos realizar o pagamento, *manda o comprovante aqui pra baixo* 👇\n\n` +
        `📲 *WhatsApp Suporte:* (18) 99679-6654\n\n` +
        `O suporte valida e libera seu acesso na hora! 🚀`
      );
      return;
    }
    const plan=String(sessionData.plan||"");
    await sendText(fromE164,plan==="series"
      ?`Aguardando seu pagamento! ⏳\n\nAssim que o PIX confirmar, mando sua serie automaticamente! 🎉`
      :`Aguardando confirmacao do seu pagamento! ⏳\n\nO acesso e liberado automaticamente assim que o PIX confirmar.\n\nSe quiser mudar de plano, so me falar! 😊`);
    return;
  }

  if(step==="access_sent"||step==="series_sent"){
    const email=String(sessionData.email||"");
    if(step==="series_sent"){
      const idSeries=String(sessionData.identified_series||"");
      if(idSeries && findSeries(idSeries)){
        const star=buildAnuncioStarMsg(idSeries);
        if(star)await sendText(fromE164,star);
        await sendText(fromE164,`😊 E de bonus, aqui estao todas as series:👇`);
        await sendText(fromE164,buildHighlightedSeriesMsg(idSeries));
      } else {
        await sendText(fromE164,`Claro! Aqui estao as series novamente 😊👇`);
        await sendText(fromE164,buildGenericSeriesMsg());
      }
      return;
    }
    await sendText(fromE164,`Seu acesso ja esta liberado! 😊`);
    if(email)await sendAccessHelp(fromE164,email);
    return;
  }

  if(step==="support"){
    await sendText(fromE164,`Pode falar! 😊 Em que posso te ajudar?\n\n• Problema para acessar\n• Esqueceu a senha\n• Duvidas sobre o catalogo\n• Outro assunto\n\nOu fale direto: ${SUPORTE_HUMANO}`);
    await updateSession(fromE164,"support_detail",sessionData);
    return;
  }

  if(step==="support_detail"){
    const isAccess=msg.includes("acesso")||msg.includes("entrar")||msg.includes("login")||msg.includes("senha")||msg.includes("esqueci")||msg.includes("nao consigo")||msg.includes("conta");
    const email=String(sessionData.email||"");
    if(isAccess&&email)await sendAccessHelp(fromE164,email);
    else await sendText(fromE164,`Para atendimento personalizado:\n${SUPORTE_HUMANO} 😊`);
    await updateSession(fromE164,"start",{});
    return;
  }

  await sendText(fromE164,`Oiie! 🫰 Quer aproveitar nossos pacotes?\n\n1️⃣ *1 Serie (a do anuncio) por R$10,00* (recebe aqui no WhatsApp)\n2️⃣ *Mensal* — R$16,90\n3️⃣ *Trimestral* — R$47,90\n\nResponda *1*, *2* ou *3*!`);
  await updateSession(fromE164,"choose_plan",sessionData);
}

async function finalizarCadastro(fromE164: string, name: string, email: string, sessionData: any, receivingPhoneNumberId?: string|null) {
  if (!(await cbAllowPix())) return;
  if (!(await pixDayAllow(fromE164))) return;
  const plan=(sessionData.plan as "monthly"|"quarterly")||"monthly";
  const planLabel=plan==="quarterly"?"Trimestral — R$47,90":"Mensal — R$16,90";
  const acc=await createUserAccount(name,fromE164,email);
  let pix:any=null;
  try{pix=await createAsaasPix(email,name,plan,fromE164,{
    user_id: (acc as any)?.userId || null,
    identified_series: sessionData.identified_series || null,
    ctwa_clid: sessionData.ctwa_clid || null,
    ad_source_id: sessionData.ad_source_id || null,
    receiving_phone_number_id: receivingPhoneNumberId || null,
  });}catch(e){
    console.error("[asaas pix]",String(e));
    await sendText(fromE164,`Conta criada! Mas houve um erro ao gerar o PIX 😅 Fale com o suporte: ${SUPORTE_HUMANO}`);
    return;
  }
  const greeting=`Conta criada com sucesso, ${name}! 🎉`;
  await sendText(fromE164,`${greeting}\n\nPlano ${planLabel} — seu PIX esta pronto! 💸\n\n⬇️ Na *proxima mensagem* esta o codigo PIX.\n\nSegure e toque em *Copiar* — cole no *PIX Copia e Cola* do seu banco.\n\n⏳ Assim que confirmar, libero seu acesso automaticamente! ✅`);
  await sendText(fromE164,pix.copyPaste);
  await updateSession(fromE164,"waiting_payment",{...sessionData,email,name,plan,order_nsu:pix.externalReference,pix_payload:pix.copyPaste});
}

async function resolveIdentifiedSeries(toE164: string, sess: any): Promise<string> {
  let idSeries = String(sess?.data?.identified_series || "");
  if (idSeries) return idSeries;
  try {
    const { data } = await supabase.from("pix_payments")
      .select("identified_series,created_at")
      .like("order_nsu", `%|${digitsOnly(toE164)}|series|%`)
      .not("identified_series","is",null)
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    if (data?.identified_series) idSeries = String(data.identified_series);
  } catch {}
  return idSeries;
}

serve(async (req) => {
  const url=new URL(req.url);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
  if(req.method==="GET"){
    if(url.searchParams.get("selftest")==="alert" && url.searchParams.get("key")===SELFTEST_KEY){
      await tripAlert("TESTE de alerta (selftest manual). Pode ignorar.");
      return jsonRes(200,{ok:true,selftest:"alert disparado (email + whatsapp best-effort)"});
    }
    const mode=url.searchParams.get("hub.mode");
    const token=url.searchParams.get("hub.verify_token");
    const challenge=url.searchParams.get("hub.challenge");
    if(mode==="subscribe"&&token===WHATSAPP_VERIFY_TOKEN&&challenge)return new Response(challenge,{status:200});
    return jsonRes(200,{ok:true,message:"whatsapp sales bot v30 (series update)"});
  }
  if(req.method==="POST"&&url.pathname.endsWith("/notify-access")){
    try{
      const body=await req.json().catch(()=>({}));
      const phone=String(body?.phone||"");
      const name=String(body?.name||"");
      const email=String(body?.email||"");
      const plan=String(body?.plan||"");
      if(!phone)return jsonRes(400,{ok:false,error:"phone required"});
      const toE164=normalizeToE164BR(phone);
      const sess=await getSession(toE164);
      if(plan==="series"){
        const idSeries=String(body?.identified_series||"")||await resolveIdentifiedSeries(toE164,sess);
        if(idSeries && findSeries(idSeries)) await sendText(toE164,buildHighlightedSeriesMsg(idSeries));
        else await sendText(toE164,buildGenericSeriesMsg());
        await updateSession(toE164,"series_sent",{...(sess?.data||{}),email,name,plan,identified_series:idSeries});
      } else {
        await sendText(toE164,buildAccessMsg(email));
        const idSeries=await resolveIdentifiedSeries(toE164,sess);
        if(idSeries && findSeries(idSeries)){ const p=buildPresenteMsg(idSeries); if(p)await sendText(toE164,p); }
        await updateSession(toE164,"access_sent",{...(sess?.data||{}),email,name,plan,identified_series:idSeries});
      }
      return jsonRes(200,{ok:true});
    }catch(e){return jsonRes(500,{ok:false,error:String(e)});}
  }
  if(req.method==="POST"&&url.pathname.endsWith("/send-manual")){
    try{
      const authHeader=req.headers.get("Authorization")||"";
      const jwt=authHeader.replace(/^Bearer\s+/i,"").trim();
      if(!jwt)return jsonRes(401,{ok:false,error:"missing token"});
      const {data:userData,error:userErr}=await supabase.auth.getUser(jwt);
      const email=(userData?.user?.email||"").toLowerCase();
      if(userErr||email!==ADMIN_EMAIL)return jsonRes(401,{ok:false,error:"unauthorized"});
      const body=await req.json().catch(()=>({}));
      const phone=String(body?.phone||"");
      const text=String(body?.text||body?.message||"").trim();
      if(!phone||!text)return jsonRes(400,{ok:false,error:"phone and text required"});
      await sendText(normalizeToE164BR(phone),text);
      return jsonRes(200,{ok:true});
    }catch(e){return jsonRes(500,{ok:false,error:String(e)});}
  }
  if(req.method==="POST"){
    let body:any=null;
    try{body=await req.json();}catch{return jsonRes(200,{ok:true});}
    try{
      const entries=Array.isArray(body?.entry)?body.entry:[];
      for(const entry of entries){
        for(const change of(Array.isArray(entry?.changes)?entry.changes:[])){
          const value=change?.value||{};
          const receivingId=value?.metadata?.phone_number_id?String(value.metadata.phone_number_id):null;
          if(Array.isArray(value?.statuses)&&value.statuses.length&&!Array.isArray(value?.messages))continue;
          for(const msg of(Array.isArray(value?.messages)?value.messages:[])){
            const fromRaw=String(msg?.from||"");
            if(!fromRaw)continue;
            const fromE164=normalizeToE164BR(fromRaw);
            const displayName=value?.contacts?.[0]?.profile?.name||null;
            const referral=msg?.referral||null;
            const msgType=String(msg?.type||"").toLowerCase();
            let text="";
            if(msgType==="text")text=String(msg?.text?.body||"");
            else if(msgType==="interactive")text=msg?.interactive?.button_reply?.title||msg?.interactive?.list_reply?.title||"";
            else text=msgType;
            if(!text)continue;
            processMessage(fromE164,text,displayName,referral,receivingId).catch(e=>console.error("[processMessage]",String(e)));
          }
        }
      }
    }catch(e){console.error("[webhook]",String(e));}
    return jsonRes(200,{ok:true});
  }
  return new Response("Method not allowed",{status:405});
});
