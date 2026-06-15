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

// ✅ admin autorizado a enviar mensagens manuais (mesmo email do painel /admin)
const ADMIN_EMAIL = "tessuportegeral@gmail.com";

// ✅ CORS — precisa estar em TODAS as respostas (não só no OPTIONS),
// senão o browser bloqueia a leitura e o supabase-js dá "Failed to send a request".
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
function generateFakeEmail(phone: string): string {
  return `${digitsOnly(phone)}@doramasplus.com`.toLowerCase();
}
function generateFakeCpf(): string {
  const n = () => Math.floor(Math.random() * 9) + 1;
  const digits = [n(),n(),n(),n(),n(),n(),n(),n(),n()];
  let sum = digits.slice(0,9).reduce((acc, v, i) => acc + v * (10 - i), 0);
  let d1 = 11 - (sum % 11); if (d1 >= 10) d1 = 0; digits.push(d1);
  sum = digits.slice(0,10).reduce((acc, v, i) => acc + v * (11 - i), 0);
  let d2 = 11 - (sum % 11); if (d2 >= 10) d2 = 0; digits.push(d2);
  return digits.join("");
}

async function saveMessage(phone: string, direction: "in" | "out", message: string) {
  try {
    await supabase.from("sales_bot_messages").insert({ phone, direction, message });
  } catch (e) { console.error("[saveMessage]", e); }
}

function detectPlan(msg: string): "monthly" | "quarterly" | null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (m==="2"||m.includes("trimes")||m.includes("3 mes")||m.includes("3mes")||m.includes("tres mes")||m.includes("47")||m.includes("maior")||m.includes("mais barato")||m.includes("melhor")||m.includes("economia")||m.includes("econom")||m.includes("longo")||m.includes("anual")||m.includes("90 dia")||m.includes("3 mese")) return "quarterly";
  if (m==="1"||m.includes("mensal")||m.includes("1 mes")||m.includes("um mes")||m.includes("16")||m.includes("mes")||m.includes("month")||m.includes("barato")||m.includes("basic")||m.includes("simpl")||m.includes("normal")||m.includes("padrao")||m.includes("30 dia")) return "monthly";
  return null;
}

function detectComplaint(msg: string): "nome" | "email" | null {
  const m = msg.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (m.includes("nome") && (m.includes("errado")||m.includes("errou")||m.includes("incorreto")||m.includes("wrong")||m.includes("diferente")||m.includes("nao e")||m.includes("nao eh")||m.includes("nao ta")||m.includes("nao esta"))) return "nome";
  if (m.includes("email") && (m.includes("errado")||m.includes("errou")||m.includes("incorreto")||m.includes("wrong")||m.includes("diferente")||m.includes("nao e")||m.includes("nao eh")||m.includes("nao ta")||m.includes("nao esta")||m.includes("nao reconhec")||m.includes("nao achei"))) return "email";
  return null;
}

function looksLikeName(text: string): boolean {
  const hasEmail = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text);
  if (hasEmail) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  return words.every(w => /^[a-zA-ZÀ-ÿ]+$/.test(w));
}

async function sendText(to: string, body: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID_1499) throw new Error("WA credentials ausentes");
  const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID_1499}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) { const t = await res.text().catch(()=>""); throw new Error(`WA send failed ${res.status}: ${t}`); }
  // Salva mensagem enviada
  await saveMessage(to, "out", body);
}

async function getOrCreateSession(phoneE164: string) {
  const { data, error } = await supabase.from("sales_bot_sessions").select("*").eq("phone", phoneE164).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: err2 } = await supabase.from("sales_bot_sessions").insert({ phone: phoneE164, step: "start", data: {} }).select("*").single();
  if (err2) throw err2;
  return created;
}

async function updateSession(phoneE164: string, step: string, data: Record<string, unknown>) {
  await supabase.from("sales_bot_sessions").upsert({ phone: phoneE164, step, data, updated_at: new Date().toISOString() }, { onConflict: "phone" });
}

async function checkExistingUser(phoneE164: string) {
  const digits = digitsOnly(phoneE164);
  const { data: profile } = await supabase.from("profiles").select("id, name, email").eq("phone", digits).maybeSingle();
  if (!profile) return null;
  const { data: sub } = await supabase.from("subscriptions").select("status, end_at").eq("user_id", profile.id).eq("status", "active").gt("end_at", new Date().toISOString()).maybeSingle();
  return { profile, subscription: sub };
}

async function createUserAccount(name: string, phone: string, email?: string) {
  const digits = digitsOnly(phone);
  const finalEmail = email || generateFakeEmail(digits);
  const { data: created, error } = await supabase.auth.admin.createUser({ email: finalEmail, password: DEFAULT_PASSWORD, email_confirm: true, user_metadata: { name, phone: digits } });
  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("exists")) return { exists: true, email: finalEmail };
    throw error;
  }
  const userId = created?.user?.id;
  if (!userId) throw new Error("no_user_id");
  await supabase.from("profiles").upsert({ id: userId, name, phone: digits, email: finalEmail }, { onConflict: "id" });
  return { exists: false, userId, email: finalEmail };
}

async function createAsaasPix(userEmail: string, userName: string, plan: "monthly" | "quarterly", phone: string) {
  const key = getAsaasKey();
  const amountCents = plan === "quarterly" ? 4790 : 1690;
  const amount = amountCents / 100;
  const externalReference = `salesbot_asaas|${digitsOnly(phone)}|${plan}|${Date.now()}`;
  const description = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Mensal";
  const fakeCpf = generateFakeCpf();

  let customerId: string | null = null;
  try {
    const searchRes = await fetch(`https://api.asaas.com/v3/customers?email=${encodeURIComponent(userEmail)}`, { headers: { "access_token": key } });
    const searchData = await searchRes.json().catch(() => ({}));
    if (searchData?.data?.[0]?.id) customerId = searchData.data[0].id;
  } catch {}

  if (!customerId) {
    const createRes = await fetch("https://api.asaas.com/v3/customers", {
      method: "POST",
      headers: { "access_token": key, "Content-Type": "application/json" },
      body: JSON.stringify({ name: userName || "Cliente DoramasPlus", email: userEmail, cpfCnpj: fakeCpf }),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok) throw new Error(`Asaas customer error ${createRes.status}: ${JSON.stringify(createData)}`);
    customerId = createData?.id || null;
  }

  if (!customerId) throw new Error("Nao foi possivel criar cliente no Asaas");

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const dueDate = tomorrow.toISOString().split("T")[0];

  const chargeRes = await fetch("https://api.asaas.com/v3/payments", {
    method: "POST",
    headers: { "access_token": key, "Content-Type": "application/json" },
    body: JSON.stringify({ customer: customerId, billingType: "PIX", value: amount, dueDate, description, externalReference }),
  });
  const chargeData = await chargeRes.json().catch(() => ({}));
  if (!chargeRes.ok) throw new Error(`Asaas charge error ${chargeRes.status}: ${JSON.stringify(chargeData)}`);

  const paymentId = chargeData?.id;
  if (!paymentId) throw new Error("Asaas nao retornou payment id");

  const pixRes = await fetch(`https://api.asaas.com/v3/payments/${paymentId}/pixQrCode`, { headers: { "access_token": key } });
  const pixData = await pixRes.json().catch(() => ({}));
  const copyPaste = pixData?.payload || null;
  if (!copyPaste) throw new Error(`PIX payload vazio: ${JSON.stringify(pixData)}`);

  try {
    await supabase.from("pix_payments").insert({ provider: "asaas", plan, amount_cents: amountCents, order_nsu: externalReference, status: "pending", raw: chargeData, source: "whatsapp_sales_bot" });
  } catch (e) { console.error("[pix_payments insert]", e); }

  return { copyPaste, externalReference, paymentId };
}

function buildAccessMsg(email: string): string {
  return `🎉 Acesso liberado com sucesso!\nSeu cadastro na DoramasPlus já está ativo ✅\n⏳ Acesso válido por 30 dias\n\n📱 Acesse agora:\n👉 ${PUBLIC_BASE_URL}\n\n➡️ Depois clique no botão *Entrar* (no topo da tela) e use os dados abaixo:\n\n👤 Login: ${email}\n🔑 Senha: ${DEFAULT_PASSWORD}\n\n🔔 Entre na nossa comunidade para receber novos doramas e avisos:\n${VIP_GROUP}\n\nQualquer dúvida é só me chamar 😊\n*Ah, e adiciona meu número pra você ficar por dentro das novidades*`;
}

async function processCollectInfo(fromE164: string, messageText: string, sessionData: any) {
  const emailMatch = messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : null;

  if (!email && looksLikeName(messageText)) {
    const nameParts = messageText.trim().split(/\s+/).filter(Boolean);
    const name = nameParts.map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    await updateSession(fromE164, "collect_email", { ...sessionData, name });
    await sendText(fromE164, `Que nome lindo, ${name}! 😊\n\nE seu *email*? Preciso dele pra criar seu acesso!`);
    return;
  }

  if (!email) {
    await sendText(fromE164, `Não consegui identificar seu email 😅\n\nMe manda assim: *Nome Sobrenome / email@exemplo.com*`);
    return;
  }

  const nameRaw = messageText.replace(emailMatch?.[0] || "", "").replace(/[\/,|\-]/g, " ").trim();
  const nameParts = nameRaw.split(/\s+/).filter(Boolean);
  const name = nameParts.slice(0, 3).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") || "Cliente";

  await finalizarCadastro(fromE164, name, email, sessionData);
}

async function finalizarCadastro(fromE164: string, name: string, email: string, sessionData: any) {
  const plan = (sessionData.plan as "monthly" | "quarterly") || "monthly";
  const planLabel = plan === "quarterly" ? "Trimestral — R$47,90" : "Mensal — R$16,90";

  const account = await createUserAccount(name, fromE164, email);

  let pix: any = null;
  try {
    pix = await createAsaasPix(account.email, name, plan, fromE164);
  } catch (e) {
    console.error("[asaas pix error]", String(e));
    await sendText(fromE164, `Conta criada! Mas houve um erro ao gerar o PIX 😅 Tente novamente ou fale com o suporte: https://wa.me/5518996796654`);
    return;
  }

  const greeting = account.exists ? `Esse email já tem uma conta!` : `Conta criada com sucesso, ${name}! 🎉`;
  await sendText(fromE164,
    `${greeting}\n\nPlano ${planLabel} — seu PIX está pronto! 💸\n\n` +
    `⬇️ Na *próxima mensagem* está o seu código PIX.\n\n` +
    `Segure a mensagem e toque em *Copiar* — depois cole no *PIX Copia e Cola* do seu banco.\n\n` +
    `⏳ Assim que o pagamento confirmar, libero seu acesso automaticamente! ✅`
  );
  await sendText(fromE164, pix.copyPaste);
  await updateSession(fromE164, "waiting_payment", { ...sessionData, email: account.email, name, plan, order_nsu: pix.externalReference });
}

// ✅ Ajuda de acesso (fallback humano só se não resolver).
// Manda o link que cai DIRETO no login e, em mensagens SEPARADAS, o email e a
// senha — clientes no celular não conseguem copiar se vier tudo junto.
async function sendAccessHelp(toE164: string, email: string) {
  await sendText(toE164,
    `Vou te ajudar a entrar na sua conta! 😊\n\n` +
    `1️⃣ Acesse este link — ele já abre direto na tela de login:\n👉 ${PUBLIC_BASE_URL}/login\n\n` +
    `Nas próximas 2 mensagens vou te mandar seu *email* e sua *senha* separados. ` +
    `É só tocar e segurar em cada mensagem, escolher *Copiar* e colar no campo certo do site 👇`
  );
  await sendText(toE164, email);
  await sendText(toE164, DEFAULT_PASSWORD);
  await sendText(toE164,
    `Pronto! Cole o *email* (1ª mensagem acima) no campo de email e a *senha* (2ª mensagem) no campo de senha, e toque em *Entrar* ✅\n\n` +
    `Se você já trocou sua senha, use a que você criou. ` +
    `E se mesmo assim não conseguir, é só me chamar aqui que eu resolvo pra você: https://wa.me/5518996796654`
  );
}

async function processMessage(fromE164: string, messageText: string, displayName: string | null) {
  // Salva mensagem recebida
  await saveMessage(fromE164, "in", messageText);

  const session = await getOrCreateSession(fromE164);
  const step = session.step || "start";
  const sessionData = session.data || {};
  const msg = messageText.trim().toLowerCase();

  if (step === "waiting_payment" || step === "access_sent") {
    const complaint = detectComplaint(msg);
    const email = String(sessionData.email || "");
    if (complaint === "nome") {
      await sendText(fromE164, `Sem problema nenhum! 😊 O nome é só uma forma de identificar seu cadastro internamente — não interfere no seu acesso. O que importa é o seu *email* e *senha* 👇`);
      if (email) await sendAccessHelp(fromE164, email);
      else await sendText(fromE164, `Me confirma o *email* que você usou no cadastro que eu te reenvio os dados? Ou me chama aqui: https://wa.me/5518996796654`);
      return;
    }
    if (complaint === "email") {
      await sendText(fromE164, `Sem estresse! 😊 O email cadastrado funciona normalmente pra acessar a plataforma, pode usar ele tranquilo 👇`);
      if (email) await sendAccessHelp(fromE164, email);
      else await sendText(fromE164, `Me confirma o *email* que você usou no cadastro que eu te reenvio os dados? Ou me chama aqui: https://wa.me/5518996796654`);
      return;
    }
  }

  if (step === "start" || step === "menu") {
    const existing = await checkExistingUser(fromE164);
    if (existing?.subscription) {
      const name = existing.profile.name || displayName || "";
      await sendText(fromE164, `Oi${name ? " "+name : ""}! 😊 Você já tem uma assinatura ativa no DoramasPlus!\n\nAcesse agora em: ${PUBLIC_BASE_URL}\n\nPrecisa de ajuda com alguma coisa?`);
      await updateSession(fromE164, "support", { ...sessionData, existing: true, email: existing.profile.email });
      return;
    }
    if (existing && !existing.subscription) {
      const name = existing.profile.name || displayName || "";
      await sendText(fromE164, `Oi${name ? " "+name : ""}! 😊 Encontrei sua conta aqui.\n\nSua assinatura venceu, mas é fácil renovar! Escolha seu plano:\n\n1️⃣ Mensal — R$16,90\n2️⃣ Trimestral — R$47,90\n\nResponda *1* ou *2* pra continuar!`);
      await updateSession(fromE164, "choose_plan", { ...sessionData, user_id: existing.profile.id, email: existing.profile.email, is_renewal: true });
      return;
    }
    await sendText(fromE164, `Oiie! Tudo bem? 🫰\nMuito Prazer, me chamo Stefano!\nFundador do DORAMASPLUS\n\n🚨 Promoção válida somente HOJE\n\nE sim temos a série do anúncio que você acabou de ver e muito mais!!!\n\n📦 Pacotes:\n🫰 1 MÊS ACESSO NO APP — R$16,90\n🫰 ACESSO TRIMESTRAL NO APP — R$47,90\n\nResponda *1* para Mensal ou *2* para Trimestral!`);
    await updateSession(fromE164, "choose_plan", { ...sessionData, is_renewal: false });
    return;
  }

  if (step === "choose_plan") {
    const plan = detectPlan(msg);
    if (!plan) {
      await sendText(fromE164, `Responde *1* para Mensal (R$16,90) ou *2* para Trimestral (R$47,90) 😊`);
      return;
    }
    await sendText(fromE164, `Ótimo! 😊\n\nMe passa seu *nome* e *email* pra eu criar sua conta:\n\nExemplo: _João Silva / joao@gmail.com_`);
    await updateSession(fromE164, "collect_info", { ...sessionData, plan });
    return;
  }

  if (step === "collect_info") {
    await processCollectInfo(fromE164, messageText, sessionData);
    return;
  }

  if (step === "collect_email") {
    const emailMatch = messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0].toLowerCase() : null;
    if (!email) {
      await sendText(fromE164, `Hmm, não identifiquei um email válido 😅\n\nMe manda assim: _seuemail@gmail.com_`);
      return;
    }
    const name = String(sessionData.name || displayName || "Cliente");
    await finalizarCadastro(fromE164, name, email, sessionData);
    return;
  }

  if (step === "waiting_payment") {
    await sendText(fromE164, `Aguardando confirmação do seu pagamento! ⏳\n\nO acesso é liberado automaticamente assim que o PIX confirmar.\n\nSe tiver alguma dúvida, pode falar aqui 😊`);
    return;
  }

  if (step === "access_sent") {
    const email = String(sessionData.email || "") || (await checkExistingUser(fromE164))?.profile?.email || "";
    if (email) {
      await sendText(fromE164, `Seu acesso já está liberado! 😊 Vou te passar tudo certinho pra você entrar 👇`);
      await sendAccessHelp(fromE164, email);
    } else {
      await sendText(fromE164, `Pra te reenviar seus dados de acesso, me confirma o *email* que você usou no cadastro? 😊\n\nSe preferir, me chama aqui: https://wa.me/5518996796654`);
    }
    return;
  }

  if (step === "support") {
    await sendText(fromE164, `Pode falar! 😊 Em que posso te ajudar?\n\n• Problema para acessar\n• Esqueceu a senha\n• Dúvidas sobre o catálogo\n• Outro assunto`);
    await updateSession(fromE164, "support_detail", sessionData);
    return;
  }

  if (step === "support_detail") {
    const isAccessIssue =
      msg.includes("acesso")||msg.includes("acessar")||msg.includes("entrar")||msg.includes("entra")||
      msg.includes("login")||msg.includes("logar")||msg.includes("senha")||msg.includes("esqueci")||
      msg.includes("nao consigo")||msg.includes("nao consego")||msg.includes("conta");
    const isCatalog =
      msg.includes("catalogo")||msg.includes("dorama")||msg.includes("serie")||msg.includes("filme")||
      msg.includes("assistir")||msg.includes("episodio");

    if (isAccessIssue) {
      // tenta resolver: reenvia acesso (link /login + email e senha separados)
      const email = String(sessionData.email || "") || (await checkExistingUser(fromE164))?.profile?.email || "";
      if (email) {
        await sendAccessHelp(fromE164, email);
      } else {
        await sendText(fromE164, `Pra te ajudar a entrar, me confirma o *email* que você usou no cadastro? Aí eu te reenvio seus dados de acesso 😊\n\nSe preferir falar comigo direto: https://wa.me/5518996796654`);
      }
    } else if (isCatalog) {
      await sendText(fromE164, `Temos um catálogo enorme de doramas, com lançamentos toda semana! 🎬\n\nÉ só acessar ${PUBLIC_BASE_URL} e buscar pelo nome.\n\nSe não achar algum título, me chama aqui que eu verifico pra você: https://wa.me/5518996796654`);
    } else {
      // fallback humano — só depois de tentar entender
      await sendText(fromE164, `Pode deixar que eu te ajudo! 😊 Me explica rapidinho o que está acontecendo que eu tento resolver aqui mesmo.\n\nSe preferir um atendimento mais detalhado, me chama neste link: https://wa.me/5518996796654`);
    }
    await updateSession(fromE164, "start", {});
    return;
  }

  await sendText(fromE164, `Oiie! 🫰 Quer assinar o DoramasPlus?\n\n1️⃣ Mensal — R$16,90\n2️⃣ Trimestral — R$47,90\n\nResponda *1* ou *2* pra começar!`);
  await updateSession(fromE164, "choose_plan", {});
}

serve(async (req) => {
  const url = new URL(req.url);
  // ✅ Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode==="subscribe"&&token===WHATSAPP_VERIFY_TOKEN&&challenge) return new Response(challenge, { status: 200 });
    return jsonRes(200, { ok: true, message: "whatsapp sales bot online" });
  }
  if (req.method==="POST"&&url.pathname.endsWith("/notify-access")) {
    try {
      const body = await req.json().catch(()=>({}));
      const phone = String(body?.phone||"");
      const name = String(body?.name||"");
      const email = String(body?.email||"");
      if (!phone) return jsonRes(400, { ok: false, error: "phone required" });
      const toE164 = normalizeToE164BR(phone);
      await sendText(toE164, buildAccessMsg(email));
      await updateSession(toE164, "access_sent", { email, name });
      return jsonRes(200, { ok: true });
    } catch (e) { return jsonRes(500, { ok: false, error: String(e) }); }
  }
  // ✅ NOVO: envio manual (humano) pelo painel admin /admin/bot-vendas
  // Protegido: exige o JWT do admin logado (mesmo email do AdminRoute).
  if (req.method==="POST"&&url.pathname.endsWith("/send-manual")) {
    try {
      const authHeader = req.headers.get("Authorization") || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!jwt) return jsonRes(401, { ok: false, error: "missing token" });

      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      const email = (userData?.user?.email || "").toLowerCase();
      if (userErr || email !== ADMIN_EMAIL) {
        return jsonRes(401, { ok: false, error: "unauthorized" });
      }

      const body = await req.json().catch(()=>({}));
      const phone = String(body?.phone||"");
      // aceita tanto "text" quanto "message" pra evitar mismatch frontend/backend
      const text = String(body?.text || body?.message || "").trim();
      if (!phone || !text) return jsonRes(400, { ok: false, error: "phone and text/message required" });

      const toE164 = normalizeToE164BR(phone);
      await sendText(toE164, text); // sendText já salva como direction "out"
      return jsonRes(200, { ok: true });
    } catch (e) { return jsonRes(500, { ok: false, error: String(e) }); }
  }
  if (req.method==="POST") {
    let body: any = null;
    try { body = await req.json(); } catch { return jsonRes(200, { ok: true }); }
    try {
      const entries = Array.isArray(body?.entry) ? body.entry : [];
      for (const entry of entries) {
        for (const change of (Array.isArray(entry?.changes)?entry.changes:[])) {
          const value = change?.value||{};
          if (Array.isArray(value?.statuses)&&value.statuses.length&&!Array.isArray(value?.messages)) continue;
          for (const msg of (Array.isArray(value?.messages)?value.messages:[])) {
            const fromRaw = String(msg?.from||"");
            if (!fromRaw) continue;
            const fromE164 = normalizeToE164BR(fromRaw);
            const displayName = value?.contacts?.[0]?.profile?.name||null;
            const msgType = String(msg?.type||"").toLowerCase();
            let text = "";
            if (msgType==="text") text = String(msg?.text?.body||"");
            else if (msgType==="interactive") text = msg?.interactive?.button_reply?.title||msg?.interactive?.list_reply?.title||"";
            else text = msgType;
            if (!text) continue;
            processMessage(fromE164, text, displayName).catch(e=>console.error("[processMessage]", String(e)));
          }
        }
      }
    } catch (e) { console.error("[webhook]", String(e)); }
    return jsonRes(200, { ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
});
