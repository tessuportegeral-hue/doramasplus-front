import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "doramasplus_sales_verify";
const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || "https://doramasplus.com.br";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";
const DEFAULT_PASSWORD = "123456";
const VIP_GROUP = "https://chat.whatsapp.com/HSG7dv1uz0FD07J5Uz2o0k";
const ADMIN_EMAIL = "tessuportegeral@gmail.com";
const SUPORTE_HUMANO = "https://wa.me/5518996796654";
const SUPORTE_NUMERO = "+55 18 99679-6654";
const EMPRESA_CNPJ = "66.108.496/0001-20";
const EMPRESA_NOME = "Stefano Servicos de Streaming";
const SITE = "www.doramasplus.com.br";

const SERIES_DRIVE_LINKS: Record<string, string> = {
  "O Amor que Deixei Escapar": "https://player.mediadelivery.net/play/624586/bc001156-66d6-49d2-8373-b3a25153949d",
  "Viciada no Melhor amigo do meu Irmao": "https://player.mediadelivery.net/play/688480/879155f0-d1b3-41da-9ec0-f15b7f230f82",
  "Jogo do Destino": "https://player.mediadelivery.net/play/688480/64615a24-3f4a-424d-8fe3-1b5eb0cab035",
  "Sai da minha vida meu Primeiro amor Acabou": "https://player.mediadelivery.net/play/688480/f78df363-d92a-479e-a761-075086eee040",
  "Prefiro Morrer a te Amar de Novo": "https://player.mediadelivery.net/play/688480/9c52b33b-1b80-46a0-b98f-3f040fe9db69",
  "Quando o Destino assinou por Mim": "https://player.mediadelivery.net/play/624586/df231e2d-fc25-4e2f-a871-80cf53994745",
};

const SERIES_ORDER = [
  "O Amor que Deixei Escapar",
  "Viciada no Melhor amigo do meu Irmao",
  "Jogo do Destino",
  "Sai da minha vida meu Primeiro amor Acabou",
  "Prefiro Morrer a te Amar de Novo",
  "Quando o Destino assinou por Mim",
];

function buildSeriesMsg(identifiedSeries: string | null): string {
  if (!identifiedSeries || !SERIES_DRIVE_LINKS[identifiedSeries]) {
    return `\u{1F389} Aqui estao suas series! Aproveite! \u{1F60A}\n\n` +
      `1\u{FE0F}\u{20E3} *O Amor que Deixei Escapar*\n\u{1F449} ${SERIES_DRIVE_LINKS["O Amor que Deixei Escapar"]}\n\n` +
      `2\u{FE0F}\u{20E3} *Viciada no Melhor amigo do meu Irmao*\n\u{1F449} ${SERIES_DRIVE_LINKS["Viciada no Melhor amigo do meu Irmao"]}\n\n` +
      `3\u{FE0F}\u{20E3} *Jogo do Destino*\n\u{1F449} ${SERIES_DRIVE_LINKS["Jogo do Destino"]}\n\n` +
      `4\u{FE0F}\u{20E3} *Sai da minha vida meu Primeiro amor Acabou*\n\u{1F449} ${SERIES_DRIVE_LINKS["Sai da minha vida meu Primeiro amor Acabou"]}\n\n` +
      `5\u{FE0F}\u{20E3} *Prefiro Morrer a te Amar de Novo*\n\u{1F449} ${SERIES_DRIVE_LINKS["Prefiro Morrer a te Amar de Novo"]}\n\n` +
      `\u{2728} *Bonus:* Quando o Destino assinou por Mim\n\u{1F449} ${SERIES_DRIVE_LINKS["Quando o Destino assinou por Mim"]}\n\n` +
      `\u{1F4FA} Quer assistir mais de 2000 series + atualizacoes diarias? Acesse: ${SITE}`;
  }
  const others = SERIES_ORDER.filter(s => s !== identifiedSeries);
  let msg = `\u{1F389} Aqui esta a serie que voce pediu! \u{1F60A}\n\n` +
    `\u{1F449} *${identifiedSeries}*\n${SERIES_DRIVE_LINKS[identifiedSeries]}\n\n` +
    `\u{2728} E de bonus, separei mais essas pra voce:\n\n`;
  const emojis = ["1\u{FE0F}\u{20E3}","2\u{FE0F}\u{20E3}","3\u{FE0F}\u{20E3}","4\u{FE0F}\u{20E3}","5\u{FE0F}\u{20E3}","6\u{FE0F}\u{20E3}"];
  others.forEach((s, i) => {
    msg += `${emojis[i] || "\u{2B50}"} *${s}*\n\u{1F449} ${SERIES_DRIVE_LINKS[s]}\n\n`;
  });
  msg += `\u{1F4FA} Quer assistir mais de 2000 series + atualizacoes diarias? Acesse: ${SITE}`;
  return msg;
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
async function saveMessage(phone: string, direction: "in"|"out", message: string, mediaUrl?: string|null) {
  try { await supabase.from("sales_bot_messages").insert({ phone, direction, message, ...(mediaUrl ? { media_url: mediaUrl } : {}) }); } catch {}
}

async function saveMediaToStorage(mediaId: string, mimeType: string, phone: string): Promise<string|null> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });
    const metaData = await metaRes.json();
    const downloadUrl = metaData?.url;
    if (!downloadUrl) { console.error("[saveMedia] no url in meta response", JSON.stringify(metaData).slice(0,200)); return null; }
    const mediaRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
    if (!mediaRes.ok) { console.error("[saveMedia] download failed", mediaRes.status); return null; }
    const buffer = await mediaRes.arrayBuffer();
    const ext = mimeType.split("/")[1]?.split(";")[0]?.replace("mpeg","mp3").replace("ogg","ogg").replace("aac","aac") || "bin";
    const filename = `${phone}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("whatsapp-media").upload(filename, buffer, { contentType: mimeType, upsert: false });
    if (error) { console.error("[saveMedia] upload error", String(error.message)); return null; }
    const { data: { publicUrl } } = supabase.storage.from("whatsapp-media").getPublicUrl(filename);
    return publicUrl;
  } catch(e) { console.error("[saveMedia]", String(e)); return null; }
}

async function resolveSeriesFromReferral(adId: string | null | undefined, campaignId: string | null | undefined): Promise<string | null> {
  try {
    const adIdStr = adId ? String(adId).trim() : null;
    console.log("[series] resolveSeriesFromReferral called adId=", JSON.stringify(adIdStr), "type=", typeof adId, "campaignId=", JSON.stringify(campaignId));
    if (adIdStr) {
      const { data: adRow, error: adErr } = await supabase.from("ad_series_map").select("series_name").eq("ad_id", adIdStr).maybeSingle();
      console.log("[series] ad_series_map result", JSON.stringify(adRow), "error=", adErr ? String(adErr.message) : null);
      if (adRow?.series_name) { console.log("[series] ad_series_map hit", adIdStr, adRow.series_name); return adRow.series_name; }
    }
    let resolvedCampaignId = campaignId ? String(campaignId).trim() : null;
    if (adIdStr && !resolvedCampaignId) {
      const { data: cacheRow, error: cacheErr } = await supabase.from("ad_campaign_cache").select("campaign_id").eq("ad_id", adIdStr).maybeSingle();
      console.log("[series] ad_campaign_cache result", JSON.stringify(cacheRow), "error=", cacheErr ? String(cacheErr.message) : null);
      if (cacheRow?.campaign_id) {
        resolvedCampaignId = cacheRow.campaign_id;
        console.log("[series] ad_campaign_cache hit", adIdStr, resolvedCampaignId);
      } else if (META_ACCESS_TOKEN) {
        const graphUrl = `https://graph.facebook.com/v20.0/${adIdStr}?fields=campaign_id&access_token=***`;
        console.log("[series] calling Graph API", graphUrl);
        try {
          const r = await fetch(`https://graph.facebook.com/v20.0/${adIdStr}?fields=campaign_id&access_token=${META_ACCESS_TOKEN}`);
          const rawText = await r.text();
          console.log("[series] graph api status=", r.status, "body=", rawText.slice(0, 300));
          const d = (() => { try { return JSON.parse(rawText); } catch { return {}; } })();
          if (d?.campaign_id) {
            resolvedCampaignId = String(d.campaign_id).trim();
            await supabase.from("ad_campaign_cache").upsert({ ad_id: adIdStr, campaign_id: resolvedCampaignId, cached_at: new Date().toISOString() });
            console.log("[series] graph api campaign_id saved", adIdStr, resolvedCampaignId);
          } else {
            console.log("[series] graph api no campaign_id in response", JSON.stringify(d));
          }
        } catch(e) { console.error("[series] graph api fetch error", String(e)); }
      } else {
        console.log("[series] no META_ACCESS_TOKEN set, skipping graph api");
      }
    }
    if (resolvedCampaignId) {
      const { data: campRow, error: campErr } = await supabase.from("campaign_series_map").select("series_name").eq("campaign_id", resolvedCampaignId).maybeSingle();
      console.log("[series] campaign_series_map result", JSON.stringify(campRow), "error=", campErr ? String(campErr.message) : null);
      if (campRow?.series_name) { console.log("[series] campaign_series_map hit", resolvedCampaignId, campRow.series_name); return campRow.series_name; }
    }
    console.log("[series] no series found for adId=", adIdStr, "campaignId=", resolvedCampaignId);
  } catch(e) { console.error("[series] resolveSeriesFromReferral error", String(e)); }
  return null;
}

function detectOption(msg: string): "series"|"monthly"|"quarterly"|null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  if (m==="1"||m.includes("serie")||m.includes("drive")||m.includes("10")||m.includes("avuls")) return "series";
  if (m==="2"||m.includes("mensal")||m.includes("1 mes")||m.includes("um mes")||m.includes("16")||m.includes("month")||m.includes("30 dia")) return "monthly";
  if (m==="3"||m.includes("trimes")||m.includes("3 mes")||m.includes("tres mes")||m.includes("47")||m.includes("90 dia")||m.includes("anual")||m.includes("melhor")||m.includes("mais barato")) return "quarterly";
  return null;
}
function detectComplaint(msg: string): "nome"|"email"|null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  if (m.includes("nome")&&(m.includes("errado")||m.includes("errou")||m.includes("incorreto")||m.includes("diferente")||m.includes("nao e")||m.includes("nao ta")||m.includes("nao esta"))) return "nome";
  if (m.includes("email")&&(m.includes("errado")||m.includes("errou")||m.includes("incorreto")||m.includes("diferente")||m.includes("nao e")||m.includes("nao ta")||m.includes("nao esta")||m.includes("nao reconhec")||m.includes("nao achei"))) return "email";
  return null;
}
function cantDoPix(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  return (
    m.includes("nao sei fazer") || m.includes("nao consigo fazer") || m.includes("nao sei pix") ||
    m.includes("nao consigo pix") || m.includes("como faz") || m.includes("como fazer") ||
    m.includes("nao sei como") || m.includes("nao entendi") || m.includes("assim nao") ||
    m.includes("nao consigo") || m.includes("codigo nao") || m.includes("assim com codigo") ||
    m.includes("nao funciona") || m.includes("nao to conseguindo") || m.includes("nao estou conseguindo") ||
    m.includes("como uso") || m.includes("como utilizo") || m.includes("me ajuda") ||
    m.includes("me explica") || m.includes("explica") || m.includes("nao acho") ||
    m.includes("onde colo") || m.includes("onde fico") || m.includes("onde coloco")
  );
}
function wantsChangeplan(msg: string): "series"|"monthly"|"quarterly"|null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const wantsChange = m.includes("mudar") || m.includes("muda") || m.includes("trocar") || m.includes("troca") ||
    m.includes("quero o") || m.includes("quero a") || m.includes("quero uma") || m.includes("prefiro") || m.includes("na verdade") ||
    m.includes("quero mudar") || m.includes("posso mudar") || m.includes("quero outro") || m.includes("quero outra") ||
    m.includes("quero o mensal") || m.includes("quero mensal") || m.includes("quero trimestral") || m.includes("quero a serie") ||
    m.includes("errei") || m.includes("foi engano") || m.includes("cliquei errado") || m.includes("escolhi errado") ||
    m.includes("coloquei errado") || m.includes("errado") || m.includes("era ") || m.includes("quero mudar de plano");
  if (!wantsChange) return null;
  const opt = detectOption(m);
  return opt;
}
function wantsChangePlanIntent(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  return m.includes("mudar de plano") || m.includes("trocar de plano") || m.includes("muda de plano") ||
    m.includes("mudar o plano") || m.includes("trocar o plano") || m.includes("outro plano") ||
    m.includes("outra opcao") || m.includes("outra op") || m.includes("coloquei errado") ||
    m.includes("errei o plano") || m.includes("escolhi errado") || m.includes("cliquei errado") ||
    m.includes("foi engano") || m.includes("quero mudar");
}
function askingAboutPlan(msg: string): "monthly"|"quarterly"|"any"|null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const isQuestion = m.includes("?") || m.includes("como") || m.includes("o que") || m.includes("oque") ||
    m.includes("o que e") || m.includes("me fala") || m.includes("me conta") || m.includes("explica") ||
    m.includes("funciona") || m.includes("como funciona") || m.includes("tem acesso") || m.includes("da acesso") ||
    m.includes("posso") || m.includes("consigo") || m.includes("assistir") || m.includes("ver") ||
    m.includes("quais") || m.includes("qual") || m.includes("que series") || m.includes("que tem") || m.includes("o que tem");
  if (!isQuestion) return null;
  const mentionsMonthly = m.includes("mensal") || m.includes("1 mes") || m.includes("um mes") || m.includes("30 dia") || m.includes("16");
  const mentionsQuarterly = m.includes("trimes") || m.includes("3 mes") || m.includes("tres mes") || m.includes("90 dia") || m.includes("47");
  const mentionsPlan = m.includes("plano") || m.includes("assinatura") || m.includes("pacote") || m.includes("acesso");
  if (mentionsMonthly && !mentionsQuarterly) return "monthly";
  if (mentionsQuarterly && !mentionsMonthly) return "quarterly";
  if (mentionsPlan || mentionsMonthly || mentionsQuarterly) return "any";
  return null;
}
function asksIfWhatsapp(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const mentionsWhatsapp = m.includes("whatsapp") || m.includes("whats") || m.includes("zap") ||
    m.includes("aqui mesmo") || m.includes("aqui no zap") || m.includes("pelo zap") ||
    m.includes("pelo whats") || m.includes("no zap") || m.includes("por aqui") ||
    m.includes("nesse zap") || m.includes("nesse whats") || m.includes("aqui no whats");
  const mentionsSite = m.includes("site") || m.includes("app") || m.includes("aplicativo") || m.includes("plataforma");
  const isQuestion = m.includes("e no") || m.includes("e aqui") || m.includes("e pelo") || m.includes("vai ser no") ||
    m.includes("vai ser pelo") || m.includes("manda aqui") || m.includes("recebo aqui") || m.includes("e tudo aqui") ||
    m.includes("e por aqui") || m.includes("onde assisto") || m.includes("onde fica") || m.includes("onde vejo") ||
    m.includes("como funciona") || m.includes("como e") || m.includes("como fica") || m.includes("como recebo") ||
    m.includes("como assisto") || m.includes("?");
  return (mentionsWhatsapp || mentionsSite) && isQuestion;
}
function detectRefusal(msg: string): boolean {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  return (
    m.includes("nao quero") || m.includes("nao obrigada") || m.includes("nao obrigado") ||
    m.includes("desisto") || m.includes("cancelar") || m.includes("cancela") ||
    m.includes("deixa pra la") || m.includes("mudei de ideia") ||
    m.includes("nao precisa") || m.includes("nao vou querer") || m.includes("vou querer nao") ||
    m.includes("esquece") || m.includes("valeu mas nao") ||
    m.includes("obrigada mas nao") || m.includes("obrigado mas nao")
  );
}
function looksLikeName(text: string): boolean {
  if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) return false;
  const lower = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const rejectWords = ["quero","nao","obrigada","obrigado","sim","vou","querer","cancelar","desisto","precisa","deixa"];
  if (rejectWords.some(w => lower.includes(w))) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length<1||words.length>4) return false;
  return words.every(w=>/^[a-zA-ZÀ-ÿ]+$/.test(w));
}
async function sendText(to: string, body: string) {
  if (!WHATSAPP_TOKEN||!WHATSAPP_PHONE_NUMBER_ID_1499) throw new Error("WA credentials ausentes");
  const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID_1499}/messages`,{
    method:"POST",
    headers:{Authorization:`Bearer ${WHATSAPP_TOKEN}`,"Content-Type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{body}}),
  });
  if (!res.ok){const t=await res.text().catch(()=>"");throw new Error(`WA send failed ${res.status}: ${t}`);}
  await saveMessage(to,"out",body);
}
async function responderOndeFica(to: string, plan: string) {
  if (plan === "series") {
    await sendText(to, `Sim! \u{1F44D} A serie voce recebe *aqui mesmo pelo WhatsApp*. \u{1F60A}\n\nVoce paga o PIX e eu te mando o link direto aqui no chat. Simples assim!`);
  } else {
    await sendText(to, `O atendimento e feito aqui pelo WhatsApp, mas as series voce assiste pelo nosso *site*! \u{1F4FA}\n\n\u{1F449} *${SITE}*\n\nDepois que voce pagar o PIX, eu te mando o *login e senha aqui no chat* pra voce acessar e assistir mais de 2000 series quando quiser! \u{1F60A}`);
  }
}
async function getOrCreateSession(phone: string) {
  const {data,error}=await supabase.from("sales_bot_sessions").select("*").eq("phone",phone).maybeSingle();
  if(error)throw error;
  if(data)return data;
  const {data:c,error:e2}=await supabase.from("sales_bot_sessions").insert({phone,step:"start",data:{}}).select("*").single();
  if(e2)throw e2;
  return c;
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
    if(m.includes("already")||m.includes("exists"))return{exists:true,email:finalEmail};
    throw error;
  }
  const userId=created?.user?.id;
  if(!userId)throw new Error("no_user_id");
  await supabase.from("profiles").upsert({id:userId,name,phone:digits,email:finalEmail},{onConflict:"id"});
  return{exists:false,userId,email:finalEmail};
}
async function createAsaasPix(userEmail: string, userName: string, plan: "monthly"|"quarterly"|"series", phone: string, ctwaClid?: string | null, adSourceId?: string | null, identifiedSeries?: string | null) {
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
    if(d?.data?.[0]?.id){
      customerId=d.data[0].id;
      try{
        await fetch(`https://api.asaas.com/v3/customers/${customerId}`,{method:"PUT",headers:{"access_token":key,"Content-Type":"application/json"},body:JSON.stringify({notificationDisabled:true})});
      }catch{}
    }
  }catch{}
  if(!customerId){
    const r=await fetch("https://api.asaas.com/v3/customers",{method:"POST",headers:{"access_token":key,"Content-Type":"application/json"},body:JSON.stringify({name:userName||"Cliente DoramasPlus",email:userEmail,cpfCnpj:fakeCpf,notificationDisabled:true})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(`Asaas customer error ${r.status}: ${JSON.stringify(d)}`);
    customerId=d?.id||null;
  }
  if(!customerId)throw new Error("Nao foi possivel criar cliente no Asaas");
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
  try{
    await supabase.from("pix_payments").insert({
      provider:"asaas",plan,amount_cents:amountCents,order_nsu:externalReference,
      status:"pending",raw:d2,source:"whatsapp_sales_bot",
      ctwa_clid: ctwaClid || null,
      ad_source_id: adSourceId || null,
      identified_series: identifiedSeries || null,
    });
  }catch(e){ console.error("[pix_payments pending insert]", String(e)); }
  return{copyPaste,externalReference,paymentId};
}
function buildAccessMsg(email: string): string {
  return `\u{1F389} Acesso liberado com sucesso!\nSeu cadastro na DoramasPlus ja esta ativo \u{2705}\n\u{23F3} Acesso valido por 30 dias\n\n\u{1F4F1} Acesse agora:\n\u{1F449} ${PUBLIC_BASE_URL}\n\nAperta em *Entrar* (no topo da tela) e usa os dados abaixo:\n\n\u{1F464} Login: ${email}\n\u{1F511} Senha: ${DEFAULT_PASSWORD}\n\nDepois e so apertar em *Entrar* e ta dentro! \u{1F513}\n\n\u{1F514} Entre na nossa comunidade para receber novos doramas e avisos:\n${VIP_GROUP}\n\nQualquer duvida e so me chamar \u{1F60A}\n*Ah, e adiciona meu numero pra voce ficar por dentro das novidades*`;
}
async function sendAccessHelp(to: string, email: string) {
  await sendText(to,`Vou te ajudar a entrar! \u{1F60A}\n\n\u{1F449} ${PUBLIC_BASE_URL}\n\nAperta em *Entrar* (no topo da tela) e usa os dados abaixo:\n\n\u{1F464} Login: ${email}\n\u{1F511} Senha: ${DEFAULT_PASSWORD}\n\nDepois e so apertar em *Entrar* e ta dentro! \u{1F513}`);
}
async function explicarPix(to: string, plan: string) {
  const valor = plan==="series" ? "R$10,00" : plan==="quarterly" ? "R$47,90" : "R$16,90";
  await sendText(to,
    `Vou te explicar como fazer o PIX! \u{1F60A}\u{2B07}\u{FE0F}\n\n` +
    `1\u{FE0F}\u{20E3} Abra o *aplicativo do seu banco* (Nubank, Inter, Bradesco, qualquer um)\n` +
    `2\u{FE0F}\u{20E3} Procure a opcao *PIX* ou *Pagar*\n` +
    `3\u{FE0F}\u{20E3} Escolha *PIX Copia e Cola*\n` +
    `4\u{FE0F}\u{20E3} Volte aqui no WhatsApp, *segure a mensagem com o codigo* e toque em *Copiar*\n` +
    `5\u{FE0F}\u{20E3} Cole o codigo no campo do banco\n` +
    `6\u{FE0F}\u{20E3} O valor de *${valor}* vai aparecer automaticamente\n` +
    `7\u{FE0F}\u{20E3} Confirme o pagamento!\n\n` +
    `\u{23F3} Assim que pagar, ${plan==="series" ? "mando sua serie automaticamente" : "seu acesso e liberado automaticamente"}! \u{2705}`
  );
}
async function enviarDadosCNPJ(to: string, plan: string) {
  const oque = plan==="series" ? "sua serie" : "o acesso a plataforma";
  await sendText(to, `Sem problema! Vou te passar os dados da empresa pra voce fazer o PIX manualmente \u{1F60A}`);
  await sendText(to, `*CNPJ:*\n${EMPRESA_CNPJ}`);
  await sendText(to, `*Nome:*\n${EMPRESA_NOME}`);
  await sendText(to,
    `Apos fazer o pagamento de ${plan==="series"?"R$10,00":plan==="quarterly"?"R$47,90":"R$16,90"}, ` +
    `mande o *comprovante* para o nosso suporte oficial que a gente libera ${oque} pra voce manualmente! \u{1F60A}\n\n` +
    `\u{1F449} Suporte: ${SUPORTE_NUMERO}`
  );
}
async function gerarPixSeries(fromE164: string, sessionData: any) {
  const fakeEmail = generateFakeEmail(fromE164);
  const ctwaClid = sessionData.ctwa_clid || null;
  const adSourceId = sessionData.ad_source_id || null;
  const identifiedSeries = sessionData.identified_series || null;
  let pix: any = null;
  try {
    pix = await createAsaasPix(fakeEmail, "Cliente", "series", fromE164, ctwaClid, adSourceId, identifiedSeries);
  } catch(e) {
    console.error("[asaas pix series]", String(e));
    await sendText(fromE164, `Houve um erro ao gerar o PIX \u{1F605} Tente novamente ou fale com o suporte: ${SUPORTE_HUMANO}`);
    return;
  }
  await sendText(fromE164,
    `\u{1F44C} Otima escolha! A serie do anuncio por apenas *R$10,00*!\n\n` +
    `\u{2B07}\u{FE0F} Na *proxima mensagem* esta o codigo PIX.\n\n` +
    `Segure e toque em *Copiar* — cole no *PIX Copia e Cola* do seu banco.\n\n` +
    `\u{23F3} Assim que confirmar, mando sua serie automaticamente! \u{2705}`
  );
  await sendText(fromE164, pix.copyPaste);
  await updateSession(fromE164, "waiting_payment", { ...sessionData, plan: "series", order_nsu: pix.externalReference, pix_help_count: 0 });
}
async function trocarPlano(fromE164: string, novoPlano: "series"|"monthly"|"quarterly", sessionData: any) {
  await sendText(fromE164, `Sem problema! Vou gerar um novo PIX pra voce \u{1F60A}`);
  if (novoPlano === "series") {
    await gerarPixSeries(fromE164, { ...sessionData, plan: undefined, name: undefined, email: undefined });
    return;
  }
  const existingEmail = String(sessionData.email || "");
  const existingName = String(sessionData.name || "");
  if (existingEmail && existingName && !existingEmail.includes("@doramasplus.com")) {
    await finalizarCadastro(fromE164, existingName, existingEmail, { ...sessionData, plan: novoPlano });
  } else {
    await sendText(fromE164, `Me passa seu *nome* e *email* pra eu criar sua conta:\n\nExemplo: _Joao Silva / joao@gmail.com_`);
    await updateSession(fromE164, "collect_info", { ...sessionData, plan: novoPlano });
  }
}
function extractReferral(msg: any): { ctwa_clid?: string; source_id?: string; source_url?: string; headline?: string } | null {
  const ref = msg?.referral;
  if (!ref) return null;
  return {
    ctwa_clid: ref.ctwa_clid || undefined,
    source_id: ref.source_id || undefined,
    source_url: ref.source_url || undefined,
    headline: ref.headline || undefined,
  };
}
async function processMessage(fromE164: string, messageText: string, displayName: string|null, referral: any, inMediaUrl?: string|null) {
  await saveMessage(fromE164,"in",messageText, inMediaUrl);
  const session=await getOrCreateSession(fromE164);
  const step=session.step||"start";
  let sessionData=session.data||{};
  const msg=messageText.trim().toLowerCase();

  if (referral?.ctwa_clid && !sessionData.ctwa_clid) {
    sessionData = { ...sessionData, ctwa_clid: referral.ctwa_clid, ad_source_id: referral.source_id || null };
    await updateSession(fromE164, step, sessionData);
  }
  // re-tenta resolver serie se tem ad_source_id mas ainda nao identificou
  if (sessionData.ad_source_id && !sessionData.identified_series) {
    const identifiedSeries = await resolveSeriesFromReferral(sessionData.ad_source_id, null);
    console.log("[serie re-resolve]", fromE164, "ad_source_id=", sessionData.ad_source_id, "result=", identifiedSeries);
    if (identifiedSeries) {
      sessionData = { ...sessionData, identified_series: identifiedSeries };
      await updateSession(fromE164, step, sessionData);
    }
  }

  const planQuestion = askingAboutPlan(msg);
  if (planQuestion && (step==="choose_plan"||step==="start"||step==="menu"||step==="collect_info"||step==="collect_email"||step==="waiting_payment")) {
    if (planQuestion === "monthly") {
      await sendText(fromE164, `\u{1F4FA} O *Plano Mensal* (R$16,90) da acesso completo ao nosso site por 30 dias:\n\n\u{1F449} *${SITE}*\n\nVoce entra com login e senha e pode assistir *mais de 2000 series* — quando quiser, quantas quiser! \u{1F60A}\n\n\u{1F504} Atualizamos o catalogo *todo dia* com series novas.\n\nQuer garantir agora?`);
    } else if (planQuestion === "quarterly") {
      await sendText(fromE164, `\u{1F4FA} O *Plano Trimestral* (R$47,90) da acesso completo ao nosso site por 90 dias:\n\n\u{1F449} *${SITE}*\n\nVoce entra com login e senha e pode assistir *mais de 2000 series* — quando quiser, quantas quiser! \u{1F60A}\n\n\u{1F504} Atualizamos o catalogo *todo dia* com series novas.\n\n\u{1F4B0} Melhor custo-beneficio: sai em conta R$15,97/mes!\n\nQuer garantir agora?`);
    } else {
      await sendText(fromE164, `\u{1F4FA} Os planos dao acesso completo ao nosso site:\n\n\u{1F449} *${SITE}*\n\nVoce entra com login e senha e pode assistir *mais de 2000 series* — quando quiser, quantas quiser! \u{1F60A}\n\n\u{1F504} Atualizamos o catalogo *todo dia* com series novas.\n\nTemos duas opcoes:\n\n2\u{FE0F}\u{20E3} *Mensal* — R$16,90 (30 dias)\n3\u{FE0F}\u{20E3} *Trimestral* — R$47,90 (90 dias, melhor custo!)\n\nResponda *2* ou *3* pra garantir agora! \u{1F60A}`);
    }
    return;
  }

  if (asksIfWhatsapp(msg) && (step==="start"||step==="menu"||step==="waiting_payment"||step==="choose_plan"||step==="collect_info"||step==="collect_email"||step==="access_sent"||step==="series_sent"||step==="series_upsell_sent")) {
    const plan = String(sessionData.plan || "");
    if (plan) { await responderOndeFica(fromE164, plan); return; }
    else { await sendText(fromE164, `Depende do pacote! \u{1F60A}\n\n1\u{FE0F}\u{20E3} *1 Serie* — voce recebe *aqui no WhatsApp*\n2\u{FE0F}\u{20E3} *Mensal / Trimestral* — voce assiste pelo nosso *site* (${SITE}), eu te mando o login aqui no chat\n\nQual voce prefere?`); return; }
  }

  if (detectRefusal(msg) && (step==="collect_info"||step==="collect_email"||step==="choose_plan"||step==="waiting_payment")) {
    await sendText(fromE164, `Sem problema! \u{1F60A} Se mudar de ideia e so me chamar. Temos otimas series te esperando! \u{1F49B}`);
    await updateSession(fromE164, "start", {});
    return;
  }

  if (step==="waiting_payment") {
    const planoAtual = String(sessionData.plan || "");
    const novoPlano = wantsChangeplan(msg);
    if (novoPlano && novoPlano !== planoAtual) { await trocarPlano(fromE164, novoPlano, sessionData); return; }
    // detecta intenção de mudar mas sem plano especificado → pergunta qual
    if (!novoPlano && wantsChangePlanIntent(msg)) {
      await sendText(fromE164, `Sem problema! \u{1F60A} Pra qual plano quer mudar?\n\n1\u{FE0F}\u{20E3} 1 Serie — R$10,00\n2\u{FE0F}\u{20E3} Mensal — R$16,90\n3\u{FE0F}\u{20E3} Trimestral — R$47,90\n\nResponda *1*, *2* ou *3*!`);
      return;
    }
    // número direto diferente do plano atual → muda plano
    const planoDireto = detectOption(msg);
    if (planoDireto && planoDireto !== planoAtual) { await trocarPlano(fromE164, planoDireto, sessionData); return; }
  }

  if (step==="waiting_payment" && cantDoPix(msg)) {
    const plan = String(sessionData.plan || "monthly");
    const helpCount = Number(sessionData.pix_help_count || 0);
    if (helpCount === 0) { await explicarPix(fromE164, plan); await updateSession(fromE164, "waiting_payment", { ...sessionData, pix_help_count: 1 }); }
    else { await enviarDadosCNPJ(fromE164, plan); await updateSession(fromE164, "waiting_payment", { ...sessionData, pix_help_count: 2 }); }
    return;
  }

  if(step==="waiting_payment"||step==="access_sent"){
    const complaint=detectComplaint(msg);
    const email=String(sessionData.email||"");
    if(complaint==="nome"){await sendText(fromE164,`Sem problema! \u{1F60A} O nome e so interno, nao interfere no seu acesso.`);if(email)await sendAccessHelp(fromE164,email);return;}
    if(complaint==="email"){await sendText(fromE164,`Sem estresse! \u{1F60A} O email funciona normalmente pra acessar.`);if(email)await sendAccessHelp(fromE164,email);return;}
  }

  if(step==="start"||step==="menu"){
    const existing=await checkExistingUser(fromE164);
    if(existing?.subscription){
      const name=existing.profile.name||displayName||"";
      await sendText(fromE164,`Oi${name?" "+name:""}! \u{1F60A} Voce ja tem assinatura ativa!\n\nAcesse: ${PUBLIC_BASE_URL}\n\nPrecisa de ajuda?`);
      await updateSession(fromE164,"support",{...sessionData,existing:true,email:existing.profile.email});
      return;
    }
    if(existing&&!existing.subscription){
      const name=existing.profile.name||displayName||"";
      await sendText(fromE164,`Oi${name?" "+name:""}! \u{1F60A} Encontrei sua conta aqui.\n\nSua assinatura venceu, mas e facil renovar!\n\n1\u{FE0F}\u{20E3} 1 Serie — R$10,00\n2\u{FE0F}\u{20E3} Mensal — R$16,90\n3\u{FE0F}\u{20E3} Trimestral — R$47,90\n\nResponda *1*, *2* ou *3*!`);
      await updateSession(fromE164,"choose_plan",{...sessionData,email:existing.profile.email,is_renewal:true});
      return;
    }
    await sendText(fromE164,
      `Oiie! Tudo bem? \u{1FAF0}\nMuito Prazer, me chamo Stefano!\nFundador do ${SITE}\n\n\u{1F6A8} Promocao valida somente HOJE\n\nE sim temos a serie do anuncio que voce acabou de ver e muito mais!!!\n\n\u{1F4E6} Escolha seu pacote:\n\n1\u{FE0F}\u{20E3} *1 Serie por R$10,00* (voce recebe aqui no WhatsApp)\n2\u{FE0F}\u{20E3} *1 MES no APP* — R$16,90 (acesso completo)\n3\u{FE0F}\u{20E3} *TRIMESTRAL no APP* — R$47,90 (melhor custo-beneficio!)\n\nResponda *1*, *2* ou *3*!`
    );
    await updateSession(fromE164,"choose_plan",{...sessionData,is_renewal:false});
    return;
  }

  if(step==="choose_plan"){
    const option=detectOption(msg);
    if(!option){await sendText(fromE164,`Responde *1* (1 Serie R$10), *2* (Mensal R$16,90) ou *3* (Trimestral R$47,90) \u{1F60A}`);return;}
    if(option==="series"){ await gerarPixSeries(fromE164, sessionData); }
    else { await sendText(fromE164,`Otimo! \u{1F60A}\n\nMe passa seu *nome* e *email* pra eu criar sua conta:\n\nExemplo: _Joao Silva / joao@gmail.com_`); await updateSession(fromE164,"collect_info",{...sessionData,plan:option}); }
    return;
  }

  if(step==="collect_info"){
    if(msg==="__media__naosuportado"){await sendText(fromE164,`Opa! \u{1F605} Nao consigo ler audio ou figurinha.\n\nMe manda seu *nome* e *email* em texto mesmo:\n\nExemplo: _Joao Silva / joao@gmail.com_`);return;}
    if(msg==="__media__comprovante"){await sendText(fromE164,`Ainda preciso do seu *nome* e *email* antes de liberar o acesso! \u{1F60A}\n\nMe manda assim: _Joao Silva / joao@gmail.com_`);return;}
    const switchedPlan = detectOption(msg);
    if (switchedPlan) {
      if (switchedPlan === "series") { await gerarPixSeries(fromE164, sessionData); return; }
      const currentPlan = String(sessionData.plan || "");
      if (switchedPlan !== currentPlan) {
        const planLabel = switchedPlan==="quarterly" ? "Trimestral — R$47,90" : "Mensal — R$16,90";
        await sendText(fromE164, `Beleza! Mudei pra ${planLabel}. Me passa seu *nome* e *email* pra eu criar sua conta \u{1F60A}`);
        await updateSession(fromE164, "collect_info", { ...sessionData, plan: switchedPlan });
        return;
      }
    }
    const emailMatch=messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const email=emailMatch?emailMatch[0].toLowerCase():null;
    if(!email&&looksLikeName(messageText)){
      const name=messageText.trim().split(/\s+/).filter(Boolean).map((w:string)=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
      await updateSession(fromE164,"collect_email",{...sessionData,name});
      await sendText(fromE164,`Que nome lindo, ${name}! \u{1F60A}\n\nE seu *email*?`);
      return;
    }
    if(!email){await sendText(fromE164,`Nao consegui identificar seu email \u{1F605}\n\nMe manda assim: *Nome Sobrenome / email@exemplo.com*`);return;}
    const nameRaw=messageText.replace(emailMatch?.[0]||"","").replace(/[\/,|\-]/g," ").trim();
    const name=nameRaw.split(/\s+/).filter(Boolean).slice(0,3).map((w:string)=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ")||"Cliente";
    await finalizarCadastro(fromE164,name,email,sessionData);
    return;
  }

  if(step==="collect_email"){
    if(msg==="__media__naosuportado"){await sendText(fromE164,`Opa! \u{1F605} Nao consigo ler audio ou figurinha.\n\nMe manda seu *email* em texto:\n\nExemplo: _joao@gmail.com_`);return;}
    if(msg==="__media__comprovante"){await sendText(fromE164,`Ainda preciso do seu *email* antes de liberar o acesso! \u{1F60A}\n\nMe manda assim: _seuemail@gmail.com_`);return;}
    const switchedPlan = detectOption(msg);
    if (switchedPlan) {
      if (switchedPlan === "series") { await gerarPixSeries(fromE164, sessionData); return; }
      const currentPlan = String(sessionData.plan || "");
      if (switchedPlan !== currentPlan) {
        const planLabel = switchedPlan==="quarterly" ? "Trimestral — R$47,90" : "Mensal — R$16,90";
        await sendText(fromE164, `Beleza! Mudei pra ${planLabel}. Me passa seu *nome* e *email* pra eu criar sua conta \u{1F60A}`);
        await updateSession(fromE164, "collect_info", { ...sessionData, plan: switchedPlan });
        return;
      }
    }
    const emailMatch=messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const email=emailMatch?emailMatch[0].toLowerCase():null;
    if(!email){await sendText(fromE164,`Hmm, nao identifiquei um email valido \u{1F605}\n\nMe manda assim: _seuemail@gmail.com_`);return;}
    const name=String(sessionData.name||displayName||"Cliente");
    await finalizarCadastro(fromE164,name,email,sessionData);
    return;
  }

  if(step==="waiting_payment"){
    if(msg==="__media__comprovante"){
      await sendText(fromE164,`Recebi seu comprovante! \u{1F44D}\n\nVou verificar e liberar seu acesso em instantes. Aguarda so um momento! \u{23F3}\u{2705}`);
      return;
    }
    const plan=String(sessionData.plan||"");
    await sendText(fromE164,plan==="series"
      ?`Aguardando seu pagamento! \u{23F3}\n\nAssim que o PIX confirmar, mando sua serie automaticamente! \u{1F389}\n\nSe quiser mudar de plano, so me falar! \u{1F60A}`
      :`Aguardando confirmacao do seu pagamento! \u{23F3}\n\nO acesso e liberado automaticamente assim que o PIX confirmar.\n\nSe quiser mudar de plano, so me falar! \u{1F60A}`);
    return;
  }

  if(step==="series_sent"||step==="series_upsell_sent"){
    const mn=msg.normalize("NFD").replace(/[̀-ͯ]/g,"");
    // verifica series PRIMEIRO — evita tratar "quero a serie do anuncio" como pedido de assinatura
    const cantOpen =
      // nao abre / nao abriu
      mn.includes("nao abriu") || mn.includes("nao abre") || mn.includes("nao ta abrindo") || mn.includes("nao esta abrindo") ||
      mn.includes("nao abro") || mn.includes("nao abri") || mn.includes("nao consigo abrir") ||
      // nao funciona / erro
      mn.includes("nao funciona") || mn.includes("nao funcionou") || mn.includes("nao funcionando") ||
      mn.includes("deu erro") || mn.includes("dando erro") || mn.includes("erro") || mn.includes("problema") ||
      mn.includes("travou") || mn.includes("travado") || mn.includes("bugou") || mn.includes("bugado") ||
      // nao carrega
      mn.includes("nao carregou") || mn.includes("nao carrega") || mn.includes("nao ta carregando") || mn.includes("nao esta carregando") ||
      mn.includes("nao carregando") || mn.includes("demora") || mn.includes("demorando") || mn.includes("demorou") ||
      // nao consigo / nao to conseguindo
      mn.includes("nao consigo") || mn.includes("nao to conseguindo") || mn.includes("nao estou conseguindo") ||
      mn.includes("nao consegui") || mn.includes("nao consigo acessar") || mn.includes("nao consigo ver") ||
      mn.includes("nao consigo assistir") || mn.includes("nao consigo entrar") || mn.includes("nao consigo logar") ||
      // nao sei
      mn.includes("nao sei abrir") || mn.includes("nao sei como") || mn.includes("nao sei usar") ||
      mn.includes("nao sei entrar") || mn.includes("nao sei acessar") ||
      // como abro / como acesso
      mn.includes("como abro") || mn.includes("como abre") || mn.includes("como acesso") || mn.includes("como entro") ||
      mn.includes("como faco pra abrir") || mn.includes("como faco pra entrar") || mn.includes("como faco pra acessar") ||
      mn.includes("como faz pra abrir") || mn.includes("como faz pra entrar") ||
      // pedidos de ajuda
      mn.includes("me ajuda") || mn.includes("me ajude") || mn.includes("socorro") || mn.includes("ajuda ai") ||
      mn.includes("preciso de ajuda") || mn.includes("nao ta dando") || mn.includes("nao esta dando") ||
      // invalido / nao aceita / nao reconhece
      mn.includes("invalido") || mn.includes("nao aceita") || mn.includes("nao reconhece") || mn.includes("nao reconheceu") ||
      mn.includes("nao deixa") || mn.includes("nao ta deixando") || mn.includes("nao esta deixando") ||
      // senha / login errado
      mn.includes("senha errada") || mn.includes("senha incorreta") || mn.includes("senha invalida") ||
      mn.includes("login errado") || mn.includes("email errado") || mn.includes("nao lembro") ||
      mn.includes("esqueci a senha") || mn.includes("esqueci o email") || mn.includes("esqueci minha senha") ||
      // link quebrado / pagina
      mn.includes("link nao") || mn.includes("link quebrado") || mn.includes("pagina nao") || mn.includes("pagina deu") ||
      mn.includes("site nao") || mn.includes("site ta") || mn.includes("site esta") ||
      // audio/legenda (quem comprou série)
      mn.includes("sem audio") || mn.includes("sem legenda") || mn.includes("nao tem audio") || mn.includes("nao tem legenda") ||
      mn.includes("audio nao") || mn.includes("legenda nao");
    if(cantOpen){
      await sendText(fromE164,
        `Vou te ajudar! \u{1F60A}\n\n` +
        `1\u{FE0F}\u{20E3} Clique no *link* que eu te mandei\n` +
        `2\u{FE0F}\u{20E3} O video vai abrir direto no navegador — aperta o *play* \u{25B6}\u{FE0F}\n` +
        `3\u{FE0F}\u{20E3} Se pedir pra abrir no navegador, aperta em *Abrir*\n` +
        `4\u{FE0F}\u{20E3} Pronto! A serie vai carregar pra voce assistir \u{2705}\n\n` +
        `Se continuar com problema, fala comigo que resolvo! \u{1F64F}`
      );
      return;
    }
    const asksForSeries =
      // palavras diretas sobre serie/conteudo
      mn.includes("serie") || mn.includes("link") || mn.includes("drive") || mn.includes("video") ||
      mn.includes("filme") || mn.includes("dorama") || mn.includes("episodio") || mn.includes("ep ") ||
      mn.includes("anuncio") || mn.includes("titulo") || mn.includes("conteudo") || mn.includes("acesso") ||
      // perguntas de localizacao
      mn.includes("nao achei") || mn.includes("nao encontrei") || mn.includes("nao encontro") ||
      mn.includes("cade") || mn.includes("cadê") || mn.includes("onde") || mn.includes("kd") ||
      mn.includes("nao vi") || mn.includes("nao vejo") || mn.includes("sumiu") || mn.includes("desapareceu") ||
      // nao recebeu
      mn.includes("nao recebi") || mn.includes("nao chegou") || mn.includes("nao caiu") ||
      mn.includes("nao apareceu") || mn.includes("nao aparece") || mn.includes("nao mandou") ||
      mn.includes("mandou nao") || mn.includes("cadê minha") || mn.includes("cade minha") ||
      // pedindo para mandar
      mn.includes("manda") || mn.includes("mande") || mn.includes("envia") || mn.includes("me passa") ||
      mn.includes("me manda") || mn.includes("me envia") || mn.includes("pode mandar") || mn.includes("pode enviar") ||
      mn.includes("me da") || mn.includes("me manda") || mn.includes("quero ver") || mn.includes("quero assistir") ||
      // assistir / ver
      mn.includes("assistir") || mn.includes("assistindo") || mn.includes("ver a") || mn.includes("ver o") ||
      mn.includes("como vejo") || mn.includes("como assisto") || mn.includes("como vo assistir") ||
      mn.includes("como vo ver") || mn.includes("posso assistir") || mn.includes("posso ver") ||
      // comprovante / pagamento
      mn.includes("paguei") || mn.includes("ja paguei") || mn.includes("fiz o pix") || mn.includes("fiz pix") ||
      mn.includes("pix feito") || mn.includes("pix foi") || mn.includes("transferi") || mn.includes("transferencia") ||
      mn.includes("comprovante") || mn.includes("ja paguei") || mn.includes("efetuei") ||
      mn.includes("realizei") || mn.includes("confirmado") || mn.includes("confirmei") ||
      mn.includes("ja fiz") || mn.includes("paguei agora") || mn.includes("acabei de pagar") ||
      mn.includes("ta pago") || mn.includes("esta pago") || mn.includes("foi pago") ||
      // perguntas simples / impaciencia
      mn.includes("qual") || mn.includes("e ai") || mn.includes("e aí") || mn.includes("oi") ||
      mn.includes("ola") || mn === "?" || mn === "oi" || mn === "ola" || mn === "ola!" ||
      mn.includes("e isso") || mn.includes("to aqui") || mn.includes("to esperando") ||
      mn.includes("quando") || mn.includes("ja") || mn === "ja" || mn === "ok" || mn === "ok!" ||
      mn.includes("recebi nao") || mn.includes("n recebi") || mn.includes("nao to vendo") ||
      // imagem/documento mandado (comprovante de pagamento ou qualquer midia)
      mn === "__media__comprovante";
    if(asksForSeries){
      const identifiedSeries = String(sessionData.identified_series || "");
      if(identifiedSeries && SERIES_DRIVE_LINKS[identifiedSeries]){
        await sendText(fromE164,
          `\u{1F4E2} *AQUI ESTA A SERIE DO ANUNCIO:*\n\n` +
          `\u{2B50}\u{2B50}\u{2B50} *${identifiedSeries}* \u{2B50}\u{2B50}\u{2B50}\n\n` +
          `\u{1F449} ${SERIES_DRIVE_LINKS[identifiedSeries]}\n\n` +
          `\u{2B06}\u{FE0F} Clique nesse link acima!`
        );
      }
      await sendText(fromE164, `\u{1F60A} E de bonus, aqui estao todas as series:\u{1F447}`);
      const seriesMsg = buildSeriesMsg(identifiedSeries || null);
      await sendText(fromE164, seriesMsg);
      return;
    }
    const wantsSub=mn==="2"||mn==="3"||mn.includes("quero")||mn.includes("sim")||mn.includes("quanto")||mn.includes("assinar")||mn.includes("mensal")||mn.includes("trimestral")||mn.includes("plano")||mn.includes("acesso")||mn.includes("vou")||mn.includes("bora")||mn.includes("gostei")||mn.includes("amei")||mn.includes("adorei")||mn.includes("interesse")||mn.includes("top")||mn.includes("como faco")||mn.includes("como assino");
    if(wantsSub){
      const dp=detectOption(msg);
      if(dp&&dp!=="series"){
        await sendText(fromE164,`Otimo! \u{1F60A}\n\nMe passa seu *nome* e *email* pra eu criar sua conta:\n\nExemplo: _Joao Silva / joao@gmail.com_`);
        await updateSession(fromE164,"collect_info",{...sessionData,plan:dp});
      } else {
        await sendText(fromE164,`Que bom que curtiu! \u{1F525}\n\nTemos dois planos pra voce:\n\n2\u{FE0F}\u{20E3} *Mensal* — R$16,90 (30 dias de acesso completo)\n3\u{FE0F}\u{20E3} *Trimestral* — R$47,90 (melhor custo-beneficio!)\n\nResponda *2* ou *3*! \u{1F60A}`);
        await updateSession(fromE164,"choose_plan",sessionData);
      }
      return;
    }
    await sendText(fromE164,`Sua serie ja foi enviada! \u{1F60A} Se quiser assistir +2000 series no site, e so me falar!\n\n\u{1F449} www.doramasplus.com.br`);
    return;
  }

  if(step==="access_sent"){
    const email=String(sessionData.email||"");
    const mn=msg.normalize("NFD").replace(/[̀-ͯ]/g,"");
    const cantAccess =
      // nao abre / nao acessa
      mn.includes("nao abre") || mn.includes("nao abriu") || mn.includes("nao ta abrindo") || mn.includes("nao esta abrindo") ||
      mn.includes("nao consigo acessar") || mn.includes("nao consigo entrar") || mn.includes("nao consigo logar") ||
      mn.includes("nao consigo") || mn.includes("nao consegui entrar") || mn.includes("nao consegui acessar") ||
      // nao funciona
      mn.includes("nao funciona") || mn.includes("nao funcionou") || mn.includes("deu erro") || mn.includes("dando erro") ||
      mn.includes("travou") || mn.includes("bugou") || mn.includes("nao carrega") || mn.includes("nao carregou") ||
      mn.includes("nao ta carregando") || mn.includes("nao esta carregando") ||
      // nao sei / como entro
      mn.includes("nao sei entrar") || mn.includes("nao sei acessar") || mn.includes("nao sei como") ||
      mn.includes("como entro") || mn.includes("como acesso") || mn.includes("como faco pra entrar") ||
      mn.includes("como faz pra entrar") || mn.includes("como faco pra acessar") ||
      // senha / login
      mn.includes("senha errada") || mn.includes("senha incorreta") || mn.includes("senha invalida") ||
      mn.includes("esqueci a senha") || mn.includes("esqueci minha senha") || mn.includes("esqueci o email") ||
      mn.includes("nao lembro") || mn.includes("nao reconhece") || mn.includes("nao reconheceu") ||
      mn.includes("nao aceita") || mn.includes("invalido") || mn.includes("login errado") || mn.includes("email errado") ||
      // site / pagina
      mn.includes("site nao") || mn.includes("pagina nao") || mn.includes("link nao") || mn.includes("link quebrado") ||
      mn.includes("nao deixa") || mn.includes("nao ta deixando") || mn.includes("nao esta deixando") ||
      // pedido de ajuda
      mn.includes("me ajuda") || mn.includes("me ajude") || mn.includes("socorro") || mn.includes("ajuda ai") ||
      mn.includes("nao to conseguindo") || mn.includes("nao estou conseguindo") ||
      mn.includes("nao ta dando") || mn.includes("nao esta dando") || mn.includes("problema");
    if(cantAccess){
      if(email) await sendAccessHelp(fromE164, email);
      else await sendText(fromE164, `Vou te ajudar! \u{1F60A} Fala com nosso suporte:\n\u{1F4AC} *+55 18 99679-6654*`);
      return;
    }
    const asksForSeries =
      mn.includes("serie") || mn.includes("dorama") || mn.includes("anuncio") || mn.includes("filme") ||
      mn.includes("ver a") || mn.includes("ver o") || mn.includes("assistir") || mn.includes("link") ||
      mn.includes("drive") || mn.includes("cade") || mn.includes("onde") || mn.includes("qual") ||
      mn.includes("nao encontrei") || mn.includes("nao achei") || mn.includes("nao encontro") ||
      mn.includes("nao vi") || mn.includes("titulo") || mn.includes("nome") || mn.includes("qual era") ||
      mn.includes("qual e") || mn.includes("qual serie") || mn.includes("que serie") ||
      mn === "__media__comprovante" || mn === "__media__naosuportado";
    if(asksForSeries){
      const identifiedSeries = String(sessionData.identified_series||"");
      if(identifiedSeries && SERIES_DRIVE_LINKS[identifiedSeries]){
        await sendText(fromE164,
          `\u{1F4FA} A serie do anuncio que voce viu e:\n\n` +
          `\u{2B50}\u{2B50}\u{2B50} *${identifiedSeries}* \u{2B50}\u{2B50}\u{2B50}\n\n` +
          `Voce pode assistir ela (e mais de 2000 outras!) pelo nosso site com seu login:\n\n` +
          `\u{1F449} *${PUBLIC_BASE_URL}*\n\nAperta em *Entrar* (no topo da tela) e usa os dados abaixo:\n\n\u{1F464} Login: ${email}\n\u{1F511} Senha: ${DEFAULT_PASSWORD}\n\nDepois e so apertar em *Entrar* e ta dentro! \u{1F513}\n\n` +
          `Qualquer duvida e so falar! \u{1F60A}`
        );
      } else {
        await sendText(fromE164,`Voce tem acesso completo a *mais de 2000 series* no nosso site! \u{1F4FA}\n\n\u{1F449} *${PUBLIC_BASE_URL}*\n\nAperta em *Entrar* (no topo da tela) e usa os dados abaixo:\n\n\u{1F464} Login: ${email}\n\u{1F511} Senha: ${DEFAULT_PASSWORD}\n\nDepois e so apertar em *Entrar* e ta dentro! \u{1F513}\n\nQualquer duvida e so falar! \u{1F60A}`);
      }
      return;
    }
    await sendText(fromE164,`Seu acesso ja esta liberado! \u{1F60A}`); if(email)await sendAccessHelp(fromE164,email); return;
  }

  if(step==="support"){
    await sendText(fromE164,`Pode falar! \u{1F60A} Em que posso te ajudar?\n\n\u{2022} Problema para acessar\n\u{2022} Esqueceu a senha\n\u{2022} Duvidas sobre o catalogo\n\u{2022} Outro assunto\n\nOu fale direto: ${SUPORTE_HUMANO}`);
    await updateSession(fromE164,"support_detail",sessionData);
    return;
  }

  if(step==="support_detail"){
    const isAccess=msg.includes("acesso")||msg.includes("entrar")||msg.includes("login")||msg.includes("senha")||msg.includes("esqueci")||msg.includes("nao consigo")||msg.includes("conta");
    const email=String(sessionData.email||"");
    if(isAccess&&email)await sendAccessHelp(fromE164,email);
    else await sendText(fromE164,`Para atendimento personalizado:\n${SUPORTE_HUMANO} \u{1F60A}`);
    await updateSession(fromE164,"start",{});
    return;
  }

  await sendText(fromE164,`Oiie! \u{1FAF0} Quer aproveitar nossos pacotes?\n\n1\u{FE0F}\u{20E3} *1 Serie por R$10,00* (recebe aqui no WhatsApp)\n2\u{FE0F}\u{20E3} *Mensal* — R$16,90\n3\u{FE0F}\u{20E3} *Trimestral* — R$47,90\n\nResponda *1*, *2* ou *3*!`);
  await updateSession(fromE164,"choose_plan",sessionData);
}
async function finalizarCadastro(fromE164: string, name: string, email: string, sessionData: any) {
  const plan=(sessionData.plan as "monthly"|"quarterly")||"monthly";
  const planLabel=plan==="quarterly"?"Trimestral — R$47,90":"Mensal — R$16,90";
  await createUserAccount(name,fromE164,email);
  let pix:any=null;
  try{pix=await createAsaasPix(email,name,plan,fromE164,sessionData.ctwa_clid||null,sessionData.ad_source_id||null,sessionData.identified_series||null);}catch(e){
    console.error("[asaas pix]",String(e));
    await sendText(fromE164,`Conta criada! Mas houve um erro ao gerar o PIX \u{1F605} Fale com o suporte: ${SUPORTE_HUMANO}`);
    return;
  }
  await sendText(fromE164,`Conta criada com sucesso, ${name}! \u{1F389}\n\nPlano ${planLabel} — seu PIX esta pronto! \u{1F4B8}\n\n\u{2B07}\u{FE0F} Na *proxima mensagem* esta o codigo PIX.\n\nSegure e toque em *Copiar* — cole no *PIX Copia e Cola* do seu banco.\n\n\u{23F3} Assim que confirmar, libero seu acesso automaticamente! \u{2705}`);
  await sendText(fromE164,pix.copyPaste);
  await updateSession(fromE164,"waiting_payment",{...sessionData,email,name,plan,order_nsu:pix.externalReference,pix_help_count:0});
}
serve(async (req) => {
  const url=new URL(req.url);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders});
  if(req.method==="GET"){
    const mode=url.searchParams.get("hub.mode");
    const token=url.searchParams.get("hub.verify_token");
    const challenge=url.searchParams.get("hub.challenge");
    if(mode==="subscribe"&&token===WHATSAPP_VERIFY_TOKEN&&challenge)return new Response(challenge,{status:200});
    return jsonRes(200,{ok:true,message:"whatsapp sales bot v55"});
  }
  if(req.method==="POST"&&url.pathname.endsWith("/notify-access")){
    try{
      const body=await req.json().catch(()=>({}));
      const phone=String(body?.phone||"");
      const name=String(body?.name||"");
      const email=String(body?.email||"");
      const plan=String(body?.plan||"");
      const orderNsu=String(body?.order_nsu||"");
      if(!phone)return jsonRes(400,{ok:false,error:"phone required"});
      const toE164=normalizeToE164BR(phone);
      if(plan==="series"){
        let identifiedSeries: string | null = null;
        const { data: sess } = await supabase.from("sales_bot_sessions").select("data").eq("phone",toE164).maybeSingle();
        if (sess?.data?.identified_series) {
          identifiedSeries = String(sess.data.identified_series);
        } else if (orderNsu) {
          const { data: pixRow } = await supabase.from("pix_payments").select("identified_series").eq("order_nsu",orderNsu).maybeSingle();
          if (pixRow?.identified_series) identifiedSeries = String(pixRow.identified_series);
        }
        const seriesMsg = buildSeriesMsg(identifiedSeries);
        await sendText(toE164, seriesMsg);
        await updateSession(toE164,"series_sent",{email,name,plan,identified_series:identifiedSeries||null});
      } else {
        await sendText(toE164,buildAccessMsg(email));
        // se vier de anuncio com serie identificada, manda a serie como bonus
        let identifiedSeriesBonus: string | null = null;
        const { data: sessBonus } = await supabase.from("sales_bot_sessions").select("data").eq("phone",toE164).maybeSingle();
        if (sessBonus?.data?.identified_series) {
          identifiedSeriesBonus = String(sessBonus.data.identified_series);
        } else if (orderNsu) {
          const { data: pixRowBonus } = await supabase.from("pix_payments").select("identified_series").eq("order_nsu",orderNsu).maybeSingle();
          if (pixRowBonus?.identified_series) identifiedSeriesBonus = String(pixRowBonus.identified_series);
        }
        if (identifiedSeriesBonus && SERIES_DRIVE_LINKS[identifiedSeriesBonus]) {
          await sendText(toE164, `\u{1F381} De presente especial, aqui esta a serie que voce viu no anuncio:\n\n\u{1F449} *${identifiedSeriesBonus}*\n${SERIES_DRIVE_LINKS[identifiedSeriesBonus]}\n\nAproveite! \u{1F60A}`);
        }
        await updateSession(toE164,"access_sent",{email,name,plan,identified_series:identifiedSeriesBonus||null});
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
      const userEmail=(userData?.user?.email||"").toLowerCase();
      if(userErr||userEmail!==ADMIN_EMAIL)return jsonRes(401,{ok:false,error:"unauthorized"});
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
          if(Array.isArray(value?.statuses)&&value.statuses.length&&!Array.isArray(value?.messages))continue;
          for(const msg of(Array.isArray(value?.messages)?value.messages:[])){
            const fromRaw=String(msg?.from||"");
            if(!fromRaw)continue;
            const fromE164=normalizeToE164BR(fromRaw);
            const displayName=value?.contacts?.[0]?.profile?.name||null;
            const msgType=String(msg?.type||"").toLowerCase();
            let text="";
            let incomingMediaId:string|null=null;
            let incomingMimeType:string|null=null;
            if(msgType==="text")text=String(msg?.text?.body||"");
            else if(msgType==="interactive")text=msg?.interactive?.button_reply?.title||msg?.interactive?.list_reply?.title||"";
            else if(msgType==="image"||msgType==="document"||msgType==="video"){
              text="__media__comprovante";
              incomingMediaId=String(msg?.[msgType]?.id||"");
              incomingMimeType=String(msg?.[msgType]?.mime_type||"image/jpeg");
            }else if(msgType==="audio"||msgType==="sticker"){
              text="__media__naosuportado";
              incomingMediaId=String(msg?.[msgType]?.id||"");
              incomingMimeType=String(msg?.[msgType]?.mime_type||(msgType==="audio"?"audio/ogg":"image/webp"));
            }else if(msgType==="reaction"||msgType==="unsupported")continue;
            else text=msgType;
            if(!text)continue;
            const referral=extractReferral(msg);
            if(referral) console.log("[referral recebido]",fromE164,JSON.stringify(referral));
            if(incomingMediaId){
              const capturedId=incomingMediaId,capturedMime=incomingMimeType||"application/octet-stream",capturedPhone=fromE164,capturedText=text,capturedName=displayName,capturedRef=referral;
              saveMediaToStorage(capturedId,capturedMime,capturedPhone).then(url=>{
                processMessage(capturedPhone,capturedText,capturedName,capturedRef,url).catch(e=>console.error("[processMessage]",String(e)));
              }).catch(()=>processMessage(capturedPhone,capturedText,capturedName,capturedRef,null).catch(e=>console.error("[processMessage]",String(e))));
            } else {
              processMessage(fromE164,text,displayName,referral).catch(e=>console.error("[processMessage]",String(e)));
            }
          }
        }
      }
    }catch(e){console.error("[webhook]",String(e));}
    return jsonRes(200,{ok:true});
  }
  return new Response("Method not allowed",{status:405});
});
