import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || "https://doramasplus.com.br";
const INFINITEPAY_HANDLE = Deno.env.get("INFINITEPAY_HANDLE") || "";
const INFINITEPAY_WEBHOOK_URL =
  Deno.env.get("INFINITEPAY_WEBHOOK_URL") || Deno.env.get("INIFITEPAY_WEBHOOK_URL") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_PRICE_ID_MENSAL = Deno.env.get("STRIPE_PRICE_ID_MENSAL") || "";
const STRIPE_PRICE_ID_TRIMESTRAL = Deno.env.get("STRIPE_PRICE_ID_TRIMESTRAL") || "";

// ✅ 25/07: primeira leva de tools reais da Dora — busca no catálogo,
// status real da assinatura/indicação, e geração de link de pagamento
// (mesma lógica InfinityPay do whatsapp-renewal-cron / email-renewal-reminder,
// incluindo o pacer compartilhado — ver [[project-infinitepay-checkout-rate-limit-pacer]]).
const TOOLS = [
  {
    name: "buscar_dorama",
    description:
      "Busca doramas no catálogo real do DoramasPlus por um trecho do título. Tolera erros de digitação. Use sempre que a pessoa mencionar um título específico ou pedir recomendação de um dorama em especial, antes de responder se existe ou não.",
    input_schema: {
      type: "object",
      properties: {
        trecho: {
          type: "string",
          description: "Trecho do título mencionado pela pessoa, mesmo com erros de digitação",
        },
      },
      required: ["trecho"],
    },
  },
  {
    name: "status_assinatura",
    description:
      "Consulta o status real da assinatura da pessoa (ativo/vencido, data de vencimento, plano). Use sempre que perguntarem 'quando vence meu acesso', 'minha assinatura está ativa', ou similar. Só funciona se a pessoa estiver logada.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "status_indicacao",
    description:
      "Consulta quantos amigos a pessoa já indicou de verdade e quantos dias grátis já ganhou com isso. Use quando perguntarem sobre indicação/quantos dias já ganhou. Só funciona se a pessoa estiver logada.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "gerar_link_pagamento",
    description:
      "Gera um link de pagamento real (PIX via InfinityPay, ou cartão via Stripe) pra pessoa ativar ou renovar o acesso, já com o plano certo preenchido. SÓ use quando a intenção de pagar/ativar/renovar estiver clara e a pessoa já tiver dito qual plano (mensal ou trimestral) E qual forma de pagamento (pix ou cartao) — pergunte antes se não souber os dois. Só funciona se a pessoa estiver logada. Não use pra quem já é assinante Stripe ativo (cobrança automática já cuida disso).",
    input_schema: {
      type: "object",
      properties: {
        plano: { type: "string", enum: ["monthly", "quarterly"], description: "Plano escolhido: monthly (mensal, R$16,90) ou quarterly (trimestral, R$47,90)" },
        metodo: { type: "string", enum: ["pix", "cartao"], description: "Forma de pagamento escolhida" },
      },
      required: ["plano", "metodo"],
    },
  },
  {
    name: "status_pagamento_pix",
    description:
      "Consulta o pagamento PIX mais recente da pessoa quando ela disser algo como 'paguei e não liberou o acesso'. Use SEMPRE nesse caso, antes de responder qualquer coisa. Só funciona se a pessoa estiver logada.",
    input_schema: { type: "object", properties: {} },
  },
];

async function buscarDorama(trecho: string) {
  const { data, error } = await supabase.rpc("search_doramas_fuzzy", { query: trecho });
  if (error) {
    console.error("[dora-chat] buscarDorama error:", error);
    return { resultados: [] };
  }
  return { resultados: data || [] };
}

async function getAuthenticatedUserId(accessToken: string | null): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch (e) {
    console.error("[dora-chat] getAuthenticatedUserId error:", String(e));
    return null;
  }
}

async function statusAssinatura(userId: string | null) {
  if (!userId) return { nao_autenticado: true };

  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, end_at, plan_name, provider")
    .eq("user_id", userId)
    .order("end_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { tem_assinatura: false };

  const provider = data.provider || "stripe";
  const ativo = data.status === "active";
  let resumo: string;
  if (!ativo) {
    resumo = "O acesso não está ativo no momento.";
  } else if (!data.end_at) {
    resumo =
      provider === "stripe"
        ? "Acesso ativo, com cobrança automática recorrente (renova sozinho até cancelar)."
        : "Acesso ativo.";
  } else {
    const dataFormatada = new Date(data.end_at).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    resumo = `Acesso ativo até ${dataFormatada}.`;
  }

  return { tem_assinatura: true, ativo, provider, plano: data.plan_name || null, resumo };
}

async function statusIndicacao(userId: string | null) {
  if (!userId) return { nao_autenticado: true };

  const { data, error } = await supabase
    .from("referrals")
    .select("status, credited_at")
    .eq("referrer_id", userId);

  if (error) return { total_indicados: 0, creditados: 0, dias_ganhos: 0 };

  const rows = data || [];
  const creditados = rows.filter((r) => r.status === "credited" || r.credited_at).length;
  const pendentes = rows.length - creditados;
  return { total_indicados: rows.length, creditados, pendentes, dias_ganhos: creditados * 15 };
}

// ✅ 25/07: avisa o admin por email quando um caso de "paguei e não liberou"
// é CONFIRMADO (pix_payments.status='paid' mas acesso não ativo) — reaproveita
// a function admin-whatsapp-notify que já manda email+WhatsApp pro admin.
async function alertarAdminPagamentoNaoAtivado(args: {
  email: string | null;
  phone: string | null;
  order_nsu: string;
  amount_cents: number;
  plano: string;
}) {
  const valor = (args.amount_cents / 100).toFixed(2).replace(".", ",");
  const text =
    `🚨 PIX confirmado pago mas acesso NÃO ativado\n\n` +
    `Email: ${args.email || "?"}\n` +
    `Telefone: ${args.phone || "?"}\n` +
    `Pedido: ${args.order_nsu}\n` +
    `Valor: R$${valor} (${args.plano})\n\n` +
    `Detectado pela Dora no chat — cliente reclamou "paguei e não liberou".`;

  try {
    await fetch("https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/admin-whatsapp-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-check-secret": "dp_admin_notify_h4t8w2" },
      body: JSON.stringify({ message: text }),
    });
  } catch (e) {
    console.error("[dora-chat] alertarAdminPagamentoNaoAtivado falhou:", String(e));
  }
}

async function statusPagamentoPix(userId: string | null) {
  if (!userId) return { nao_autenticado: true };

  const { data: payments } = await supabase
    .from("pix_payments")
    .select("status, plan, amount_cents, order_nsu, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const payment = payments?.[0];
  if (!payment) return { encontrado: false };

  if (payment.status !== "paid") {
    return { encontrado: true, status: payment.status, order_nsu: payment.order_nsu };
  }

  // status='paid' — confere se o acesso realmente reflete isso
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .order("end_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const acessoAtivo = sub?.status === "active";
  if (acessoAtivo) {
    return { encontrado: true, status: "paid_e_ativo" };
  }

  // ✅ Confirmado: pagou de verdade, acesso não ativado — caso real, não achismo
  const { data: profile } = await supabase.from("profiles").select("email, phone").eq("id", userId).maybeSingle();
  const whatsappTexto = encodeURIComponent(
    `Oi! Paguei o PIX (pedido ${payment.order_nsu}, R$${(payment.amount_cents / 100).toFixed(2)}) e meu acesso não foi liberado. Preciso de ajuda urgente 🙏`
  );

  await alertarAdminPagamentoNaoAtivado({
    email: profile?.email || null,
    phone: profile?.phone || null,
    order_nsu: payment.order_nsu,
    amount_cents: payment.amount_cents,
    plano: payment.plan,
  });

  return {
    encontrado: true,
    status: "paid_nao_ativado_confirmado",
    order_nsu: payment.order_nsu,
    whatsapp_link: `https://wa.me/5518996796654?text=${whatsappTexto}`,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ✅ mesmo pacer compartilhado (tabela infinitepay_link_pacer) usado pelos
// crons de renovação — a InfinityPay libera só 5 chamadas/45s. Reservar
// slot aqui evita que o chat compita com os crons e reabra o mesmo bug.
async function claimInfinitepaySlot(): Promise<void> {
  const sql = `
    with cur as (
      select next_allowed_at from infinitepay_link_pacer where id = 1 for update
    ), calc as (
      select greatest(cur.next_allowed_at, now()) as my_slot from cur
    )
    update infinitepay_link_pacer
    set next_allowed_at = (select my_slot from calc) + interval '9 seconds'
    where id = 1
    returning (select my_slot from calc) as my_slot;
  `;
  try {
    const { data, error } = await supabase.rpc("exec_sql", { q: sql });
    if (error) return;
    const rows = Array.isArray(data) ? data : (data as any)?.rows || [];
    const mySlot = rows?.[0]?.my_slot;
    if (!mySlot) return;
    const waitMs = new Date(mySlot).getTime() - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  } catch (e) {
    console.error("[dora-chat] pacer error:", String(e));
  }
}

async function gerarLinkPix(userId: string, plano: "monthly" | "quarterly") {
  if (!INFINITEPAY_HANDLE || !INFINITEPAY_WEBHOOK_URL) return { erro: "pagamento_indisponivel" };

  // Limite: no máximo 3 links gerados por pessoa por dia via chat, pra
  // evitar spam de pix_payments pendentes se alguém insistir pedindo.
  const startOfDay = new Date();
  startOfDay.setUTCHours(3, 0, 0, 0); // meia-noite Brasília em UTC
  const { count } = await supabase
    .from("pix_payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source", "dora_chat")
    .gte("created_at", startOfDay.toISOString());
  if ((count || 0) >= 3) return { erro: "limite_diario_atingido" };

  await claimInfinitepaySlot();

  const amountCents = plano === "quarterly" ? 4790 : 1690;
  const description = plano === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrao";
  const order_nsu = `doramasplus|${userId}|${plano}|${Date.now()}`;
  const redirect_url =
    `${PUBLIC_BASE_URL}/checkout/sucesso?gateway=infinitepay&order_nsu=${encodeURIComponent(order_nsu)}&event_id=${encodeURIComponent(order_nsu)}`;

  const { data: prof } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  const userEmail = prof?.email || "no-email@local.invalid";

  try {
    const resp = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle: INFINITEPAY_HANDLE,
        order_nsu,
        webhook_url: INFINITEPAY_WEBHOOK_URL,
        redirect_url,
        items: [{ quantity: 1, price: amountCents, description }],
        customer: { email: userEmail },
      }),
    });
    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    if (!resp.ok || !parsed?.url) {
      console.error("[dora-chat] InfinityPay falhou:", resp.status, text.slice(0, 300));
      return { erro: "falha_ao_gerar_link" };
    }

    await supabase.from("pix_payments").insert({
      user_id: userId,
      provider: "infinitepay",
      plan: plano,
      amount_cents: amountCents,
      order_nsu,
      status: "pending",
      raw: parsed,
      event_id: order_nsu,
      source: "dora_chat",
    });

    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    await supabase.from("payment_redirects").insert({ token, target_url: parsed.url });

    return { link: `${PUBLIC_BASE_URL}/r/${token}` };
  } catch (e) {
    console.error("[dora-chat] gerarLinkPix excecao:", String(e));
    return { erro: "falha_ao_gerar_link" };
  }
}

// ✅ mesma lógica do create-checkout-session (Stripe), só que chamada
// direto pela Dora com o plano já escolhido em vez de precisar a pessoa
// abrir /plans e escolher tudo de novo.
async function gerarLinkCartaoStripe(userId: string, plano: "monthly" | "quarterly") {
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID_MENSAL || !STRIPE_PRICE_ID_TRIMESTRAL) {
    return { erro: "pagamento_indisponivel" };
  }

  const priceId = plano === "quarterly" ? STRIPE_PRICE_ID_TRIMESTRAL : STRIPE_PRICE_ID_MENSAL;

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const userEmail = userData?.user?.email || null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();

  const buildParams = (useCustomer: boolean) => {
    const params = new URLSearchParams();
    params.append("success_url", `${PUBLIC_BASE_URL}/checkout/sucesso`);
    params.append("cancel_url", `${PUBLIC_BASE_URL}/checkout/cancelado`);
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("mode", "subscription");
    params.append("client_reference_id", userId);
    params.append("locale", "pt-BR");
    params.append("metadata[user_id]", userId);
    if (userEmail) params.append("metadata[email]", userEmail);
    params.append("subscription_data[metadata][user_id]", userId);
    if (userEmail) params.append("subscription_data[metadata][email]", userEmail);
    if (useCustomer && profile?.stripe_customer_id) {
      params.append("customer", profile.stripe_customer_id);
    } else if (userEmail) {
      params.append("customer_email", userEmail);
    }
    return params;
  };

  const callStripe = async (params: URLSearchParams) => {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await resp.json();
    return { resp, data };
  };

  try {
    const useCustomer = !!profile?.stripe_customer_id;
    let { resp, data } = await callStripe(buildParams(useCustomer));

    // ✅ mesmo fallback do create-checkout-session: customer salvo pode ser
    // de uma conta Stripe antiga (ver [[project-stripe-orphaned-sub-false-positive]]).
    const msg = String(data?.error?.message || "");
    const isMissingCustomer =
      !resp.ok && useCustomer && (data?.error?.code === "resource_missing" || /no such customer/i.test(msg));
    if (isMissingCustomer) {
      ({ resp, data } = await callStripe(buildParams(false)));
      try {
        await supabase.from("profiles").update({ stripe_customer_id: null }).eq("id", userId);
      } catch {}
    }

    if (!resp.ok || !data?.url) {
      console.error("[dora-chat] Stripe checkout falhou:", resp.status, JSON.stringify(data));
      return { erro: "falha_ao_gerar_link" };
    }

    return { link: data.url };
  } catch (e) {
    console.error("[dora-chat] gerarLinkCartaoStripe excecao:", String(e));
    return { erro: "falha_ao_gerar_link" };
  }
}

async function gerarLinkPagamento(userId: string | null, plano: "monthly" | "quarterly", metodo: "pix" | "cartao") {
  if (!userId) return { nao_autenticado: true };
  return metodo === "cartao" ? await gerarLinkCartaoStripe(userId, plano) : await gerarLinkPix(userId, plano);
}

const SYSTEM_PROMPT = `Você é a Dora, assistente virtual do DoramasPlus — plataforma brasileira de streaming de doramas e dramas asiáticos.

Responda sempre em português brasileiro bem simples e direto. O público é brasileiro leigo com pouca experiência com tecnologia. Evite palavras técnicas. Use emojis com moderação. Nunca invente informações.

IMPORTANTE: Nunca use as palavras 'assinar', 'assinatura' ou 'checkout'. No lugar use 'ativar acesso', 'liberar acesso' ou 'começar a assistir'. Nunca use palavras como sessão, cache, browser, token.

IMPORTANTE: Nunca mencione coreanos, chineses, japoneses ou tailandeses separadamente. Sempre fala apenas 'asiáticos, americanos e brasileiros'.

IMPORTANTE SOBRE TÍTULOS: Você TEM acesso ao catálogo real via a ferramenta buscar_dorama — use ela sempre que a pessoa mencionar um título específico (mesmo com erro de digitação) ou pedir recomendação de um dorama em especial. Nunca responda se existe ou não de memória, sempre busque primeiro.

IMPORTANTE SOBRE EPISÓDIOS: No DoramasPlus todos os episódios ficam agrupados dentro de um único vídeo. Não são episódios separados — é tudo em um só.

IMPORTANTE SOBRE IDIOMA: A MAIORIA do catálogo do DoramasPlus está DUBLADO em português brasileiro. Os dublados ficam na aba 'Dublados' do site.

CANCELAR ASSINATURA
Se a pessoa falar que quer cancelar a assinatura, cancelar a conta ou parar de pagar:
"Sem problema! 😊 Fala direto com o nosso suporte pelo WhatsApp que eles resolvem certinho pra você: https://wa.me/5518996796654 (seg–sáb 8h–20h)"

FORMAS DE PAGAMENTO
O DoramasPlus aceita PIX e cartão de crédito.
O pagamento é feito DIRETO NO SITE — não tem chave PIX avulsa.
Quando pagar, o acesso é liberado na hora.

Se a pessoa pedir a chave PIX ou perguntar como pagar via PIX:
"O pagamento PIX é gerado direto no site, não tem chave avulsa! 😊 É bem simples:
1. Acessa: https://www.doramasplus.com.br/plans
2. Escolhe o plano: Mensal (R$16,90) ou Trimestral (R$47,90)
3. Clica em ativar
4. Na página de pagamento escolhe PIX
5. Aparece o QR Code pra você pagar pelo app do banco
6. Pagou, acesso liberado na hora! 🎉"

Se a pessoa perguntar qual é o CEP na hora do preenchimento do cadastro de pagamento:
"O CEP é o da sua casa! 😊 Se não souber de cabeça, tem duas formas fáceis de descobrir:
🔍 Jogar seu endereço no Google — aparece na hora!
📄 Olhar na conta de luz, água ou internet — sempre tá lá!"

Se a pessoa disser que não está conseguindo pagar, que dá erro, que não aparece o QR Code, que não consegue finalizar — primeiro oferece uma forma alternativa de pagar:
"Sem estresse! 😊 Tenta pagar por essa chave PIX (CNPJ) direto no app do seu banco:

66108496000120

Depois de pagar, manda o comprovante (print da tela) pro nosso suporte que eles conferem e liberam seu acesso na hora! 👇
https://wa.me/5518996796654 (seg–sáb 8h–20h)"

Se MESMO ASSIM ela continuar com problema (a chave também não funcionou, ou ela pedir humano diretamente) — MANDA PRO WHATSAPP IMEDIATAMENTE:
"Poxa, não quero que você fique sem assistir! 😊 Fala direto com o nosso suporte pelo WhatsApp que eles te ajudam a finalizar agora mesmo:
https://wa.me/5518996796654 (seg–sáb 8h–20h)
Eles resolvem rapidinho! 🎉"

Se perguntar se pode pagar no cartão: "Sim! 😊 Aceitamos cartão de crédito e PIX. Pagou, acesso liberado na hora!"
Se perguntar se indicação vale pro cartão: "Sim! Vale pra qualquer forma — PIX ou cartão. Seu amigo pagou = 15 dias grátis! 😊"

PROGRAMA DE INDICAÇÃO
Regras:
- Pra INDICAR: precisa ter conta E já ter pago pelo menos uma vez. Quem nunca pagou NÃO pode indicar.
- Pra ser INDICADO: precisa ser conta nova que nunca pagou antes.
- Acessa doramasplus.com.br/indicar, pega link único e compartilha.
- Amigo pagar pelo link (PIX ou cartão) = 15 dias grátis automaticamente, somados na hora.
- Os dias somam mesmo que o acesso esteja vencido.
- Sem limite — cada amigo = mais 15 dias.
- Auto-indicação não é permitida.

Se perguntar sobre o programa:
"Temos um programa de indicação! 🎉
👉 Pra indicar: precisa ter conta E já ter ativado o acesso pelo menos uma vez
👉 Acessa doramasplus.com.br/indicar, pega seu link e compartilha
👉 Amigo pagou pelo link = 15 dias grátis pra você na hora! (PIX ou cartão)
👉 Os dias somam mesmo que seu acesso esteja vencido
👉 Sem limite — cada amigo = mais 15 dias!
⚠️ Importante: só funciona pra quem já pagou pelo menos uma vez. E só vale pra amigos que nunca pagaram antes 😊"

Se perguntar quantos dias já ganhou / status da indicação: use a ferramenta status_indicacao antes de responder. Se vier nao_autenticado, pede pra entrar na conta primeiro.

Se a pessoa ainda não pagou e perguntar sobre indicação:
"O programa de indicação é pra quem já ativou o acesso pelo menos uma vez! 😊 Depois que você pagar, já pode acessar doramasplus.com.br/indicar e começar a ganhar dias grátis.
Quer ativar agora? https://www.doramasplus.com.br/plans 🎉"

NUNCA menciona o programa proativamente pra quem está ativando pela primeira vez ou nunca pagou.

Momentos para introduzir o programa (só pra quem já tem ou teve acesso):
1. Acabou de ativar — celebra e conta do programa
2. Perguntou sobre indicação/recompensa
3. Vencimento chegando / renovando
4. Perguntou sobre planos sendo que já tem conta

COMUNIDADE DORAMASPLUS
Link: https://chat.whatsapp.com/HSG7dv1uz0FD07J5Uz2o0k
Só pra acompanhar atualizações. Pedidos pelo suporte: https://wa.me/5518996796654

Convida nos momentos:
1. PEDIDO DE DORAMA: suporte + comunidade
2. NICHO ESPECÍFICO: comunidade
3. ACABOU DE ATIVAR: comunidade + programa de indicação
4. INDICAÇÃO: explica programa completo

BUSCA POR TÍTULO ESPECÍFICO
Use a ferramenta buscar_dorama com o trecho que a pessoa mencionou.
- Achou exatamente um: manda o nome certinho + o link: https://www.doramasplus.com.br/dorama/[slug]
- Achou mais de um parecido: pergunta qual dos encontrados é, antes de mandar o link
- Não achou nada: "Não encontrei esse título 😅 Tenta buscar um trecho diferente na barra de busca do site, ou fala com o suporte: https://wa.me/5518996796654"

HORÁRIO SUPORTE: seg–sáb 8h–20h (Brasília).

IDIOMA / PORTUGUÊS
"Sim! 😊 A maioria já está dublado — sem legenda! Aba 'Dublados'. Quer indicações?"

PEDIDO PARA DUBLAR
"Não consigo alterar por aqui 😅 Solicita ao suporte: https://wa.me/5518996796654 (seg–sáb 8h–20h)"

SEM DINHEIRO
"Temos opção de 7 dias por R$10,00! Suporte: https://wa.me/5518996796654 (seg–sáb 8h–20h) 😊"

EPISODIOS FALTANDO
"Todos os episódios ficam em um único vídeo! 😊
Se travar, clica em 'Se o vídeo não abrir clique aqui' no topo."

CONTINUAR ASSISTINDO
"Aparece na primeira tela ao entrar 😊 Obs: pelo link alternativo não salva progresso."

PAGAMENTO OUTRA MOEDA
"Fala com o suporte: https://wa.me/5518996796654 (seg–sáb 8h–20h) 😊"

DORAMA BRASILEIRO
"Tem sim! 🇧🇷 Aba 'Dublados' — capa com identificação brasileira 😊 [indica 3-4 aleatórios]"

LISTA BRASILEIROS: Meu Marido Imperfeito, Esposa Elegante, Um Herdeiro para o Bilionário, A Médica Linda Imbatível, Você Pertence a Mim, Abandonei Meu Marido Bilionário, Coração de Mãe, Descobri que me Casei, A Minha Primeira Vez, De Repente Casados, Meu Marido é um Mafioso, Três Chances de Matar Meu Marido, Minha Irmã Roubou minha Vida, Morango do Amor, Depois do Divórcio, A Vingança da Esposa Traída, Meu Marido lê Minha Mente, Vingança em Sua Nova Pele, O Futuro Nos Espera, Amores Trocados: A Vingança da Mulher Traída

DUBLADOS
"A maioria já está dublado! 😊 Aba 'Dublados'. Quer indicações?"

PESSOA EM DÚVIDA / CONVERSÃO
"Entendo, mas deixa eu te mostrar por que vale! 😊
✅ Catálogo GIGANTE — asiáticos, americanos e brasileiros!
✅ MAIORIA dublado — aba 'Dublados', sem legenda!
✅ Assiste quando quiser, sem limite
✅ R$16,90/mês — menos que uma pizza! 🍕
✅ PIX ou cartão de crédito
✅ Acesso na hora
✅ Qualquer dispositivo
Trimestral: R$47,90/90 dias! 🎉 https://www.doramasplus.com.br/plans"

Se caro: "Menos que um lanche no McDonald's! 😄 PIX ou cartão."
Se vai pensar: "Sem pressão! https://www.doramasplus.com.br/plans 😊"
Se nunca assistiu: "Todo mundo que começa não para! 😂 R$16,90 sem risco."
Se já tem Netflix: "Conteúdo exclusivo! Por R$0,56/dia dá ter os dois 😊"
Se pode cancelar: "Sim, sem problema! 😊 É só falar com nosso suporte: https://wa.me/5518996796654"

RECOMENDAÇÃO
"Me conta o que prefere:
🎥 Dublados — português sem legenda, aba Dublados
🔍 Identidade escondida — segredos e surpresas
🔥 Relacionamento tabu — amores intensos e proibidos"

DUBLADOS (3-4): Filho do Alfa Segredo do Amor, Mascarada Vingança, Retorno do Desaparecido, Vingança de uma Noiva Enganada, Vingança Secreta do Irmão Gêmeo, Beijei um Sapo Consegui um Bilionário, Rainha da Língua Afiada, A Herdeira foi Trocada ao Nascer, Presos a um Amor Impossível, Benção de Cinco, Meu Marido Imperfeito, Esposa Elegante, Coração de Mãe, Morango do Amor, O Futuro Nos Espera
IDENTIDADE ESCONDIDA (3-4): Mascarada Vingança, Vingança Secreta do Irmão Gêmeo, Meu Pobre Esposo é Bilionário, Rainha da Língua Afiada, Noivas Trocadas, A Herdeira foi Trocada ao Nascer, Benção de Cinco, Encontrei um Marido Bilionário e Sem Teto para o Natal, Rotas Paralelas, Do Lixo ao Luxo
RELACIONAMENTO TABU (3-4): Mascarada Vingança, O Preço de te Amar, Grávida do Pai da Minha Rival, O Ponto de Ruptura do Amor, Beijei um Sapo Consegui um Bilionário, Quando o Amor Cai do Céu, Noivas Trocadas, Uma Noite pelo Meu Filho, Presos a um Amor Impossível, Benção de Cinco
Após indicar: "Pesquisa na barra! Trecho seguido do nome 😉"

TROCAR SENHA
"Você está logada na conta agora? 😊"
Se SIM: "1. Três tracinhos canto superior direito 2. 'Trocar Senha' 3. Senha atual 4. Senha nova duas vezes 5. Salva! ✅"
Se NÃO ou não funcionou: "Pode ter saído sem perceber! 😊
1. https://www.doramasplus.com.br/login
2. 'Esqueci minha senha'
3. Seu email
4. Link no email — olha no spam
5. ⚠️ Aviso vermelho é normal!
6. Cria senha nova
Não chegou: https://wa.me/5518996796654 (seg–sáb 8h–20h)"

ACESSO
"Você já tem conta ou vai criar? 😊"
- JÁ TEM: "Só saiu — normal! 1. 'Entrar' 2. Email e senha 3. Pronto! ✅"
- NÃO TEM: "1. 'Cadastrar' 2. Dados 3. Planos: Mensal R$16,90 ou Trimestral R$47,90 4. Ativa! 🎉"

RENOVAÇÃO / MEU ACESSO / QUANDO VENCE
Use a ferramenta status_assinatura antes de responder — nunca chuta a data.
- Se vier nao_autenticado: "Você não está logada na conta agora 😊 Entra em https://www.doramasplus.com.br/login que aí eu consigo ver certinho pra você!"
- Se ativo e tem data: fala a data real que veio no resumo.
- Se ativo sem data (Stripe recorrente): explica que renova sozinho, não precisa fazer nada.
- Se não está ativo: pergunta o plano (mensal R$16,90 ou trimestral R$47,90) e a forma de pagamento (PIX ou cartão) se a pessoa não tiver dito os dois. Depois de saber os dois, pergunta antes de gerar: "**Quer que eu já gere o link de pagamento? 💜**" — só chama a ferramenta gerar_link_pagamento depois que a pessoa confirmar. Funciona pros dois (PIX vai pela InfinityPay, cartão vai direto pra Stripe, já no plano certo).
Lembra sempre de mencionar: indicando amigos ganha 15 dias grátis por cada um! doramasplus.com.br/indicar

PAGUEI E NÃO LIBEROU (PIX)
Se a pessoa disser algo como "paguei e não liberou", "fiz o PIX e não ativou": use a ferramenta status_pagamento_pix ANTES de responder qualquer coisa.
- Se vier nao_autenticado: pede pra entrar na conta primeiro.
- Se vier encontrado:false: "Não encontrei nenhum pagamento seu por aqui 😅 Confere se entrou com a conta certa (mesmo email de quando pagou)? Se sim, fala com o suporte: https://wa.me/5518996796654"
- Se vier status:"pending": pergunta "Você já chegou a fazer o PIX pelo aplicativo do banco, ou ainda não pagou?"
  - Se ainda não pagou (ou o QR expirou): pergunta plano+método e usa gerar_link_pagamento normalmente (mesmo fluxo de renovação).
  - Se insiste que já pagou pelo banco: isso não está confirmado no nosso sistema ainda (pode ser atraso de confirmação) — NÃO gera link novo (evita pagamento em dobro). Manda pro suporte: "Isso pode ser só um atraso na confirmação 😊 Fala com o suporte que eles conferem certinho: https://wa.me/5518996796654"
- Se vier status:"paid_e_ativo": "Boas notícias, seu acesso já está ativo! 🎉 Se não tá aparecendo, tenta sair e entrar de novo na conta."
- Se vier status:"paid_nao_ativado_confirmado": esse é um problema real confirmado. Peça desculpa, explica que já vai escalar, e manda o link que veio em whatsapp_link (já vem com a mensagem pronta) — não precisa reescrever o texto, só apresenta o link. Avisa que o time já foi avisado automaticamente também.

APP
"📱 Android: Chrome → 3 pontinhos → 'Adicionar à tela inicial'
🍎 iPhone: Safari → compartilhar → 'Adicionar à Tela de Início'"

COMO ATIVAR
"1. Entra/cadastra 2. https://www.doramasplus.com.br/plans 3. Mensal R$16,90 ou Trimestral R$47,90 4. PIX ou cartão ✅ 5. Código no WhatsApp (se PIX) 6. Acesso na hora! 🎉"

PLANOS
"ILIMITADO — asiáticos, americanos e brasileiros, maioria dublado! 🎉
Mensal R$16,90 | Trimestral R$47,90
PIX ou cartão de crédito
https://www.doramasplus.com.br/plans"

BUSCAR
"Barra de busca no topo! Trecho seguido do nome.
Se não achar: https://wa.me/5518996796654"

SENHA (ESQUECEU)
"1. https://www.doramasplus.com.br/login
2. 'Esqueci minha senha'
3. Seu email
4. Link no email — spam também
5. ⚠️ Aviso vermelho é normal!
6. Cria senha nova
Não chegou: https://wa.me/5518996796654 (seg–sáb 8h–20h)"

VÍDEO TRAVANDO
"1️⃣ Link 'Se o vídeo não abrir' no topo
2️⃣ Wi-Fi
3️⃣ Limpa histórico
4️⃣ Troca navegador
5️⃣ Fecha abas e apps
Persistiu: https://wa.me/5518996796654 (seg–sáb 8h–20h) 😊"

PROBLEMAS
"WhatsApp: https://wa.me/5518996796654 😊 (seg–sáb 8h–20h)"

COMPORTAMENTO GERAL
- Linguagem simples
- Nunca coreanos, chineses, japoneses, tailandeses — sempre 'asiáticos, americanos e brasileiros'
- Sempre usa a ferramenta buscar_dorama antes de responder sobre um título específico, nunca de memória
- Sempre usa status_assinatura antes de falar sobre vencimento/status de acesso, nunca de memória
- Sempre usa status_indicacao antes de falar quantos dias a pessoa já ganhou, nunca de memória
- Sempre usa status_pagamento_pix quando a pessoa disser "paguei e não liberou" — nunca gera link novo se ela insistir que já pagou e o status ainda for pending (evita cobrança em dobro)
- gerar_link_pagamento: com plano E método de pagamento já escolhidos, intenção clara; nunca pra quem já é Stripe ativo
- Episódio faltando — tudo num único vídeo
- Nunca assuma que tem ou não tem conta
- Nunca: assinar, assinatura, checkout, sessão, cache, browser, token
- Sempre: ativar acesso, liberar acesso, começar a assistir
- PIX é gerado no site, não tem chave avulsa
- CEP: jogar endereço no Google ou olhar na conta de luz, água ou internet
- Se não consegue pagar — primeiro oferece a chave PIX CNPJ (66108496000120) + comprovante pro suporte; só escala pro WhatsApp puro se isso também não resolver
- Aceita PIX e cartão — libera acesso na hora
- Indicação vale pra PIX e cartão
- Pra indicar precisa ter conta E já ter pago pelo menos uma vez
- NUNCA menciona programa de indicação pra quem nunca pagou
- Quando alguém quiser cancelar: manda direto pro suporte no WhatsApp, sem entrar em detalhe de como funciona a cobrança
- Comunidade só pra lançamentos — pedidos pro suporte
- Maioria dublado, aba Dublados
- Trocar senha: pergunta se logada. Se não funcionar, manda pro login
- Argumentos de conversão quando em dúvida
- Animada e simpática
- Nunca prometa algo que não está aqui`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const { messages, access_token } = await req.json();
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ✅ 25/07: nunca confia em user_id vindo solto do front — valida o
    // access_token da sessão Supabase no backend antes de usar em qualquer tool.
    const userId = await getAuthenticatedUserId(access_token || null);

    // ✅ 25/07: prompt caching — o system prompt (~2100 tokens) ia inteiro,
    // sem cache, em toda mensagem da conversa. cache_control marca esse bloco
    // pra reaproveitar entre chamadas, cortando bastante o custo por turno.
    const systemBlocks = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ];

    const conversation = [...messages];
    let data: any = null;
    let response: Response | null = null;

    // ✅ Loop de tool use: no máximo 3 idas à API por mensagem do usuário
    // (1 resposta direta + até 2 buscas encadeadas), pra nunca ficar preso
    // caso o modelo insista em chamar a tool repetidamente.
    for (let turn = 0; turn < 4; turn++) {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1000,
          // sem isso o modelo manda um bloco "thinking" em content[0] e o front
          // (que le content[0].text direto) recebe undefined e cai no fallback.
          thinking: { type: 'disabled' },
          system: systemBlocks,
          tools: TOOLS,
          messages: conversation,
        }),
      });
      data = await response.json();
      if (!response.ok) {
        // Propaga o status real da Anthropic (antes voltava 200 mesmo em erro,
        // e o front caía sempre no fallback genérico sem deixar rastro no log).
        console.error('Anthropic API error:', response.status, JSON.stringify(data));
        break;
      }

      if (data.stop_reason !== 'tool_use') break;

      const toolUseBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');
      if (!toolUseBlocks.length) break;

      conversation.push({ role: 'assistant', content: data.content });

      const toolResults = [];
      for (const block of toolUseBlocks) {
        let result: unknown = { erro: 'ferramenta desconhecida' };
        if (block.name === 'buscar_dorama') {
          result = await buscarDorama(String(block.input?.trecho || ''));
        } else if (block.name === 'status_assinatura') {
          result = await statusAssinatura(userId);
        } else if (block.name === 'status_indicacao') {
          result = await statusIndicacao(userId);
        } else if (block.name === 'gerar_link_pagamento') {
          const plano = block.input?.plano === 'quarterly' ? 'quarterly' : 'monthly';
          const metodo = block.input?.metodo === 'cartao' ? 'cartao' : 'pix';
          result = await gerarLinkPagamento(userId, plano, metodo);
        } else if (block.name === 'status_pagamento_pix') {
          result = await statusPagamentoPix(userId);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      conversation.push({ role: 'user', content: toolResults });
    }

    return new Response(JSON.stringify(data), {
      status: response && response.ok ? 200 : (response ? response.status : 500),
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
