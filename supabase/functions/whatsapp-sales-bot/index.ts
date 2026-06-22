import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_NUMBER_ID_1499 = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID_1499") || "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "doramasplus_sales_verify";
const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || "https://doramasplus.com.br";
const DEFAULT_PASSWORD = "123456";
const VIP_GROUP = "https://chat.whatsapp.com/HSG7dv1uz0FD07J5Uz2o0k";
const ADMIN_EMAIL = "tessuportegeral@gmail.com";
const SUPORTE_HUMANO = "https://wa.me/5518996796654";

// ===== Catalogo de series (ordem canonica) =====
const SERIES: { name: string; link: string }[] = [
  { name: "O Amor que Deixei Escapar", link: "https://player.mediadelivery.net/play/624586/bc001156-66d6-49d2-8373-b3a25153949d" },
  { name: "Chefe, Ela disse nao de Novo", link: "https://drive.google.com/file/d/199tW_4UVLbFCT5TMnSA6t4vkt9oSN6c7/view?usp=drive_link" },
  { name: "Viciada no Melhor amigo do meu Irmao", link: "https://player.mediadelivery.net/play/688480/879155f0-d1b3-41da-9ec0-f15b7f230f82" },
  { name: "Jogo do Destino", link: "https://player.mediadelivery.net/play/688480/64615a24-3f4a-424d-8fe3-1b5eb0cab035" },
  { name: "Sai da minha vida meu Primeiro amor Acabou", link: "https://player.mediadelivery.net/play/688480/f78df363-d92a-479e-a761-075086eee040" },
  { name: "Prefiro Morrer a te Amar de Novo", link: "https://player.mediadelivery.net/play/688480/9c52b33b-1b80-46a0-b98f-3f040fe9db69" },
  { name: "Quando o Destino assinou por Mim", link: "https://player.mediadelivery.net/play/624586/df231e2d-fc25-4e2f-a871-80cf53994745" },
];

// Mapa anuncio (ad_id) -> serie
const AD_SERIES_MAP: Record<string, string> = {
  "23859058018740792": "Jogo do Destino",
  "23859058018750792": "O Amor que Deixei Escapar",
  "23859058018760792": "Sai da minha vida meu Primeiro amor Acabou",
};
// Mapa campanha (source_id) -> serie
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
// Identifica a serie do anuncio a partir do referral do clique (CTWA)
function identifySeriesFromReferral(ref: any): string | null {
  if (!ref || typeof ref !== "object") return null;
  // 1. Nivel de anuncio (ad_id)
  const adId = String(ref.ad_id || "");
  if (adId && AD_SERIES_MAP[adId]) return AD_SERIES_MAP[adId];
  // 2. Fallback nivel de campanha (source_id)
  const sourceId = String(ref.source_id || "");
  if (sourceId && AD_SERIES_MAP[sourceId]) return AD_SERIES_MAP[sourceId];
  if (sourceId && CAMPAIGN_SERIES_MAP[sourceId]) return CAMPAIGN_SERIES_MAP[sourceId];
  // 3. Fallback texto
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
  msg += `✨ *Bonus:* ${SERIES[6].name}\n👉 ${SERIES[6].link}\n\n`;
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
function looksLikeName(text: string): boolean {
  if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) return false;
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
async function getOrCreateSession(phone: string) {
  const {data,error}=await supabase.from("sales_bot_sessions").select("*").eq("phone",phone).maybeSingle();
  if(error)throw error;
  if(data)return data;
  const {data:c,error:e2}=await supabase.from("sales_bot_sessions").insert({phone,step:"start",data:{}}).select("*").single();
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
  return `🎉 Acesso liberado com sucesso!\nSeu cadastro na DoramasPlus ja esta ativo ✅\n⏳ Acesso valido por 30 dias\n\n📱 Acesse agora:\n👉 ${PUBLIC_BASE_URL}\n\nAperta em *Entrar* (no topo da tela) e usa os dados abaixo:\n\n👤 Login: ${email}\n🔑 Senha: ${DEFAULT_PASSWORD}\n\nDepois e so apertar em *Entrar* e ta dentro! 🔓\n\n🔔 Entre na nossa comunidade para receber novos doramas e avisos:\n${VIP_GROUP}\n\nQualquer duvida e so me chamar 😊\n*Ah, e adiciona meu numero pra voce ficar por dentro das novidades*`;
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

// Gera PIX de series direto, sem pedir nada
async function gerarPixSeries(fromE164: string, sessionData: any) {
  const fakeEmail = generateFakeEmail(fromE164);
  const idSeries = String(sessionData.identified_series || "");
  let pix: any = null;
  try {
    pix = await createAsaasPix(fakeEmail, "Cliente", "series", fromE164, {
      identified_series: idSeries || null,
      ctwa_clid: sessionData.ctwa_clid || null,
      ad_source_id: sessionData.ad_source_id || null,
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
  await updateSession(fromE164, "waiting_payment", { ...sessionData, plan: "series", order_nsu: pix.externalReference });
}

async function processMessage(fromE164: string, messageText: string, displayName: string|null, referral: any) {
  await saveMessage(fromE164,"in",messageText);
  const session=await getOrCreateSession(fromE164);
  const step=session.step||"start";
  let sessionData=session.data||{};

  // Captura o anuncio do clique (CTWA): so completa o que ainda nao tem
  if (referral && typeof referral === "object") {
    const sid = identifySeriesFromReferral(referral);
    const patch: Record<string,unknown> = {};
    if (sid && !sessionData.identified_series) patch.identified_series = sid;
    if (referral.ctwa_clid && !sessionData.ctwa_clid) patch.ctwa_clid = referral.ctwa_clid;
    if (referral.source_id && !sessionData.ad_source_id) patch.ad_source_id = referral.source_id;
    if (Object.keys(patch).length) { sessionData = { ...sessionData, ...patch }; try { await updateSession(fromE164, step, sessionData); } catch {} }
  }

  const msg=messageText.trim().toLowerCase();

  if(step==="waiting_payment"||step==="access_sent"){
    const complaint=detectComplaint(msg);
    const email=String(sessionData.email||"");
    if(complaint==="nome"){await sendText(fromE164,`Sem problema! 😊 O nome e so interno.`);if(email)await sendAccessHelp(fromE164,email);return;}
    if(complaint==="email"){await sendText(fromE164,`Sem estresse! 😊 O email funciona normalmente.`);if(email)await sendAccessHelp(fromE164,email);return;}
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
      await gerarPixSeries(fromE164, sessionData);
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
    await finalizarCadastro(fromE164,name,email,sessionData);
    return;
  }

  if(step==="collect_email"){
    const emailMatch=messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const email=emailMatch?emailMatch[0].toLowerCase():null;
    if(!email){await sendText(fromE164,`Hmm, nao identifiquei um email valido 😅\n\nMe manda assim: _seuemail@gmail.com_`);return;}
    const name=String(sessionData.name||displayName||"Cliente");
    await finalizarCadastro(fromE164,name,email,sessionData);
    return;
  }

  if(step==="waiting_payment"){
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

async function finalizarCadastro(fromE164: string, name: string, email: string, sessionData: any) {
  const plan=(sessionData.plan as "monthly"|"quarterly")||"monthly";
  const planLabel=plan==="quarterly"?"Trimestral — R$47,90":"Mensal — R$16,90";
  const acc=await createUserAccount(name,fromE164,email);
  let pix:any=null;
  try{pix=await createAsaasPix(email,name,plan,fromE164,{
    user_id: (acc as any)?.userId || null,
    identified_series: sessionData.identified_series || null,
    ctwa_clid: sessionData.ctwa_clid || null,
    ad_source_id: sessionData.ad_source_id || null,
  });}catch(e){
    console.error("[asaas pix]",String(e));
    await sendText(fromE164,`Conta criada! Mas houve um erro ao gerar o PIX 😅 Fale com o suporte: ${SUPORTE_HUMANO}`);
    return;
  }
  const greeting=`Conta criada com sucesso, ${name}! 🎉`;
  await sendText(fromE164,`${greeting}\n\nPlano ${planLabel} — seu PIX esta pronto! 💸\n\n⬇️ Na *proxima mensagem* esta o codigo PIX.\n\nSegure e toque em *Copiar* — cole no *PIX Copia e Cola* do seu banco.\n\n⏳ Assim que confirmar, libero seu acesso automaticamente! ✅`);
  await sendText(fromE164,pix.copyPaste);
  await updateSession(fromE164,"waiting_payment",{...sessionData,email,name,plan,order_nsu:pix.externalReference});
}

// Descobre a serie do anuncio para entrega (sessao -> pix_payments)
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
    const mode=url.searchParams.get("hub.mode");
    const token=url.searchParams.get("hub.verify_token");
    const challenge=url.searchParams.get("hub.challenge");
    if(mode==="subscribe"&&token===WHATSAPP_VERIFY_TOKEN&&challenge)return new Response(challenge,{status:200});
    return jsonRes(200,{ok:true,message:"whatsapp sales bot v25"});
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
            processMessage(fromE164,text,displayName,referral).catch(e=>console.error("[processMessage]",String(e)));
          }
        }
      }
    }catch(e){console.error("[webhook]",String(e));}
    return jsonRes(200,{ok:true});
  }
  return new Response("Method not allowed",{status:405});
});
