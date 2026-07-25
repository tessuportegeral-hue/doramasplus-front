import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUser } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const WHATSAPP_WEBHOOK_BASE = Deno.env.get("WHATSAPP_WEBHOOK_BASE") || "";
const ZAP_ADMIN_SECRET = Deno.env.get("ZAP_ADMIN_SECRET") || "";

const LINK_DEFAULT = Deno.env.get("RENEWAL_LINK") || "www.doramasplus.com.br/plans";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || "https://doramasplus.com.br";
const INFINITEPAY_HANDLE = Deno.env.get("INFINITEPAY_HANDLE") || "";
const INFINITEPAY_WEBHOOK_URL =
  Deno.env.get("INFINITEPAY_WEBHOOK_URL") || Deno.env.get("INIFITEPAY_WEBHOOK_URL") || "";

const TZ = "America/Sao_Paulo";

const EXCLUDED_PLAN_NAMES = ["DoramasPlus Passe Teste"];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function digitsOnly(v: string) {
  return String(v || "").replace(/\D/g, "");
}

function normalizeToE164BR(raw: string) {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length > 13) d = d.slice(-13);
  if (d.startsWith("55")) {
    const rest = d.slice(2);
    if (rest.length === 10 || rest.length === 11) return "55" + rest;
    if (d.length === 12 || d.length === 13) return d;
    return "";
  }
  if (d.length === 10 || d.length === 11) return "55" + d;
  return "";
}

function getSaoPauloDateParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value || "1970";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return { year, month, day };
}

function startOfTodaySaoPauloUTCISO() {
  const { year, month, day } = getSaoPauloDateParts();
  return new Date(`${year}-${month}-${day}T03:00:00.000Z`).toISOString();
}

// ✅ 23/07: gera um token curto (gravado em payment_redirects) pra colar
// em doramasplus.com.br/r/<token> — o botão do template de WhatsApp só
// aceita variável de URL no mesmo domínio aprovado, então o link sempre
// começa com nosso domínio e o pay-redirect (via rewrite no vercel.json)
// resolve o destino real depois do clique. Token curto em vez de
// codificar a URL inteira (a da InfinityPay já é longa por natureza).
async function createShortRedirect(targetUrl: string): Promise<string | null> {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const { error } = await supabase
    .from("payment_redirects")
    .insert({ token, target_url: targetUrl });
  if (error) {
    console.error("[renewal-link] falha ao gravar payment_redirects:", String(error));
    return null;
  }
  return token;
}

function planFromName(planName: string | null | undefined): "monthly" | "quarterly" {
  return String(planName || "").toLowerCase().includes("trimestral") ? "quarterly" : "monthly";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ✅ 24/07: achado o motivo real da falha intermitente (não é bug nosso) —
// a API de criação de checkout da InfinityPay libera só 5 chamadas em
// sequência e depois bloqueia por ~40-50s (confirmado nos horários dos
// pix_payments criados hoje: grupos de exatamente 5, sempre com esse
// intervalo). Como renew_3d/renew_1d rodam em invocações HTTP separadas,
// um contador em memória não adianta — precisa ser compartilhado via banco.
// Essa tabela guarda só um timestamp: "próximo horário liberado pra chamar
// a InfinityPay". Cada chamador reserva atomicamente o próximo slot (~9s
// depois do anterior, margem de segurança sobre o ritmo observado de 5/45s)
// e espera até lá antes de disparar o fetch — em vez de disparar rápido e
// torcer pro retry cair numa janela aberta.
async function claimInfinitepaySlot(): Promise<void> {
  try {
    const { data: mySlot, error } = await supabase.rpc("claim_infinitepay_slot");
    if (error || !mySlot) return;
    const waitMs = new Date(mySlot as string).getTime() - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  } catch (e) {
    console.error("[renewal-link] falha no pacer da InfinityPay:", String(e));
  }
}

// ✅ Gera um checkout InfinityPay novo pro user_id/plano, do mesmo jeito que
// infinitepay-create-checkout faz pro site — só que sem exigir sessão
// logada (o cron já sabe de quem é cada lembrete, direto do banco).
async function createInfinitepayCheckoutLinkAttempt(
  userId: string,
  plan: "monthly" | "quarterly"
): Promise<string | null> {
  const amountCents = plan === "quarterly" ? 4790 : 1690;
  const description = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrao";
  const order_nsu = `doramasplus|${userId}|${plan}|${Date.now()}`;
  const redirect_url =
    `${PUBLIC_BASE_URL}/checkout/sucesso` +
    `?gateway=infinitepay&order_nsu=${encodeURIComponent(order_nsu)}` +
    `&event_id=${encodeURIComponent(order_nsu)}`;

  const { data: prof } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const userEmail = prof?.email || "no-email@local.invalid";

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
  try {
    parsed = JSON.parse(text);
  } catch {}

  if (!resp.ok || !parsed?.url) {
    console.error(
      "[renewal-link] falha ao gerar checkout InfinitePay:",
      resp.status,
      text.slice(0, 300)
    );
    return null;
  }

  try {
    await supabase.from("pix_payments").insert({
      user_id: userId,
      provider: "infinitepay",
      plan,
      amount_cents: amountCents,
      order_nsu,
      status: "pending",
      raw: parsed,
      event_id: order_nsu,
      source: "whatsapp_renewal_cron",
    });
  } catch (e) {
    console.error("[renewal-link] falha ao gravar pix_payments pending:", String(e));
  }

  return String(parsed.url);
}

async function createInfinitepayCheckoutLink(
  userId: string,
  plan: "monthly" | "quarterly"
): Promise<string | null> {
  if (!INFINITEPAY_HANDLE || !INFINITEPAY_WEBHOOK_URL) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    await claimInfinitepaySlot();
    try {
      const url = await createInfinitepayCheckoutLinkAttempt(userId, plan);
      if (url) return url;
    } catch (e) {
      console.error(`[renewal-link] excecao ao gerar checkout (tentativa ${attempt}):`, String(e));
    }
  }

  return null;
}

// ✅ 23/07: gera link direto pra qualquer provider que não seja Stripe
// (infinitepay, asaas, manual, comprovante_validado, etc — todo mundo que
// pagou/foi ativado fora da Stripe usa o mesmo checkout InfinityPay pra
// renovar). Stripe continua de fora (cobrança automática já cuida disso).
async function resolveRenewalLink(
  userId: string,
  provider: string,
  planName: string | null | undefined
): Promise<string> {
  if (provider === "stripe") return LINK_DEFAULT;

  const plan = planFromName(planName);
  const checkoutUrl = await createInfinitepayCheckoutLink(userId, plan);
  if (!checkoutUrl) return LINK_DEFAULT;

  const token = await createShortRedirect(checkoutUrl);
  if (!token) return LINK_DEFAULT;

  return `${PUBLIC_BASE_URL}/r/${token}`;
}

async function sendTemplate(toE164Digits: string, template: string, name: string, link: string) {
  if (!WHATSAPP_WEBHOOK_BASE) throw new Error("WHATSAPP_WEBHOOK_BASE not set");
  const url = `${WHATSAPP_WEBHOOK_BASE}/send-template`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ZAP_ADMIN_SECRET ? { "x-zap-secret": ZAP_ADMIN_SECRET } : {}),
    },
    body: JSON.stringify({
      to: toE164Digits,
      template,
      name,
      link,
    }),
  });
  const txt = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`send-template failed ${res.status}: ${txt}`);
  return txt;
}

async function alreadySentToday(userId: string, kind: string) {
  const start = startOfTodaySaoPauloUTCISO();
  const { data, error } = await supabase
    .from("whatsapp_renewal_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", start)
    .limit(1);
  if (error) throw error;
  return (data?.length || 0) > 0;
}

async function logRow(args: {
  user_id: string;
  kind: string;
  provider?: string | null;
  sent_to?: string | null;
  template_name?: string | null;
  meta?: unknown;
}) {
  const { error } = await supabase.from("whatsapp_renewal_logs").insert({
    user_id: args.user_id,
    kind: args.kind,
    provider: args.provider ?? null,
    sent_to: args.sent_to ?? null,
    template_name: args.template_name ?? null,
    meta: args.meta ?? null,
  });
  if (error) {
    const msg = String((error as { message?: string })?.message || "").toLowerCase();
    const code = String((error as { code?: string })?.code || "");
    const isDup = code === "23505" || msg.includes("duplicate");
    if (!isDup) throw error;
  }
}

const SQL_LATEST_SUB = `
with latest_sub as (
  select distinct on (s.user_id)
    s.user_id,
    s.status,
    s.provider,
    s.end_at,
    s.plan_name,
    s.created_at
  from public.subscriptions s
  order by s.user_id, s.end_at desc nulls last, s.created_at desc nulls last
)
select
  p.id as user_id,
  coalesce(p.name, 'amigo(a)') as name,
  p.phone,
  ls.status,
  coalesce(ls.provider, '') as provider,
  ls.end_at,
  ls.plan_name
from latest_sub ls
join public.profiles p on p.id = ls.user_id
where p.phone is not null
  and length(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 10
`;

async function runBatch(kind: "renew_3d" | "renew_1d") {
  let dateFilterSql = "";
  let template = "";

  if (kind === "renew_3d") {
    template = "renovacao_3_dias";
    dateFilterSql = `
      and date(ls.end_at at time zone '${TZ}') =
          date(now() at time zone '${TZ}') + interval '3 days'
    `;
  } else {
    template = "renovacao_urgente";
    dateFilterSql = `
      and date(ls.end_at at time zone '${TZ}') =
          date(now() at time zone '${TZ}') + interval '1 day'
    `;
  }

  const providerRuleSql = `and coalesce(ls.provider,'') <> 'stripe'`;
  const statusRuleSql = `and ls.status = 'active'`;
  const planExclusionSql = EXCLUDED_PLAN_NAMES.length
    ? `and coalesce(ls.plan_name,'') not in (${EXCLUDED_PLAN_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")})`
    : "";

  const sql = `
${SQL_LATEST_SUB}
${statusRuleSql}
${dateFilterSql}
${providerRuleSql}
${planExclusionSql}
limit 500
  `.trim();

  const { data, error } = await supabase.rpc("exec_sql", { q: sql });
  if (error) throw new Error(`exec_sql error: ${JSON.stringify(error)}`);

  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { rows?: Record<string, unknown>[] })?.rows)
    ? (data as { rows?: Record<string, unknown>[] }).rows!
    : [];

  let sent = 0;
  let skipped_invalid_phone = 0;
  let skipped_already_sent = 0;
  let skipped_send_error = 0;

  for (const r of rows) {
    const userId = String(r.user_id || "");
    const name = String(r.name || "amigo(a)");
    const phoneRaw = String(r.phone || "");
    const provider = String(r.provider || "");
    const endAt = r.end_at ?? null;
    const planName = (r.plan_name as string | null) ?? null;
    const e164 = normalizeToE164BR(phoneRaw);

    if (!e164) {
      skipped_invalid_phone++;
      await logRow({ user_id: userId, kind, provider: provider || null, sent_to: null, template_name: template, meta: { reason: "invalid_phone", phone_raw: phoneRaw, end_at: endAt } });
      continue;
    }

    const dup = await alreadySentToday(userId, kind);
    if (dup) { skipped_already_sent++; continue; }

    const link = await resolveRenewalLink(userId, provider, planName);

    // ✅ 25/07: push como canal extra, junto do WhatsApp — mesmo link direto.
    // Só dispara aqui (não duplica em email-renewal-reminder) pra não mandar
    // 2 push do mesmo aviso pro mesmo dia; se a pessoa não tiver assinatura
    // de push, sendPushToUser só retorna sent:0 sem erro.
    try {
      const pushTitle = kind === "renew_1d" ? "Seu acesso vence HOJE! ⚠️" : "Seu acesso vence em 3 dias! 💜";
      const pushBody =
        kind === "renew_1d"
          ? "Não perca seus doramas — renove agora mesmo."
          : "Renove agora e continue maratonando sem interrupção.";
      const pushUrl = link.startsWith("http") ? link : `https://${link}`;
      await sendPushToUser(supabase, userId, { title: pushTitle, body: pushBody, url: pushUrl });
    } catch (e) {
      console.error("[renewal-push] falha ao enviar push:", String(e));
    }

    try {
      const providerResponse = await sendTemplate(e164, template, name, link);
      await logRow({ user_id: userId, kind, provider: provider || null, sent_to: e164, template_name: template, meta: { reason: "sent", end_at: endAt, link, provider_response: providerResponse } });
      sent++;
    } catch (e) {
      skipped_send_error++;
      await logRow({ user_id: userId, kind, provider: provider || null, sent_to: e164, template_name: template, meta: { reason: "send_error", end_at: endAt, link, error: String(e) } });
    }
  }

  return { kind, template, total: rows.length, sent, skipped: skipped_invalid_phone + skipped_already_sent + skipped_send_error };
}

serve(async (req) => {
  if (CRON_SECRET) {
    const url = new URL(req.url);
    const viaQuery = url.searchParams.get("cron_secret") || url.searchParams.get("secret") || "";
    const viaHeader = req.headers.get("x-cron-secret") || "";
    const theirs = viaHeader || viaQuery;
    if (theirs !== CRON_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
  }

  if (req.method === "HEAD") return new Response(null, { status: 200 });

  // ✅ 25/07: debug — testa resolveRenewalLink pra um user_id específico
  // sem mandar nada de verdade, só pra conferir se o link vem certo com o
  // plano da assinatura real da pessoa.
  const testLinkFor = new URL(req.url).searchParams.get("test_link_for");
  if (testLinkFor) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("provider, plan_name")
      .eq("user_id", testLinkFor)
      .order("end_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return new Response(JSON.stringify({ ok: false, error: "no_subscription" }), { status: 404 });
    const link = await resolveRenewalLink(testLinkFor, sub.provider || "", sub.plan_name);
    return new Response(JSON.stringify({ ok: true, provider: sub.provider, plan_name: sub.plan_name, link }), { status: 200 });
  }

  // ✅ 23/07: cada kind roda numa chamada separada (cron externo dispara duas
  // vezes) pra um batch lento nunca mais consumir o tempo do outro em silêncio
  // — foi exatamente isso que zerou o renew_1d a partir de 17/07. Sem ?kind=
  // (chamada antiga) ainda roda os dois em sequência, pra não quebrar nada
  // enquanto o cron externo não for atualizado.
  const kindParam = new URL(req.url).searchParams.get("kind");

  // ✅ 23/07: o cron-job.org tem teto fixo de 30s de timeout (não dá pra
  // aumentar no plano deles) e um único batch com geração de link já leva
  // 70-90s. Solução: responder na hora e continuar processando em background
  // via EdgeRuntime.waitUntil, sem depender da conexão do chamador ficar
  // aberta até o fim.
  const task = (async () => {
    try {
      const results = [];
      if (kindParam === "renew_3d" || kindParam === "renew_1d") {
        results.push(await runBatch(kindParam));
      } else {
        results.push(await runBatch("renew_3d"));
        results.push(await runBatch("renew_1d"));
      }
      // return_7d DESATIVADO - 0% de conversao
      console.log("whatsapp-renewal-cron concluido:", JSON.stringify(results));
    } catch (e) {
      console.error("fatal error", String(e));
    }
  })();

  // @ts-ignore EdgeRuntime é global do runtime das Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined") {
    // @ts-ignore
    EdgeRuntime.waitUntil(task);
  }

  return new Response(
    JSON.stringify({ ok: true, started: true, kind: kindParam || "both", timezone: TZ, started_at: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
