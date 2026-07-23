import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ✅ 23/07: codifica o link de pagamento real (InfinityPay) num token
// base64url pra colar em doramasplus.com.br/r/<token> — o botão do
// template de WhatsApp só aceita variável de URL no mesmo domínio
// aprovado, então o link sempre começa com nosso domínio e o
// pay-redirect (via rewrite no vercel.json) decodifica e manda pro
// destino de verdade depois do clique.
function base64UrlEncode(input: string): string {
  const b64 = btoa(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function planFromName(planName: string | null | undefined): "monthly" | "quarterly" {
  return String(planName || "").toLowerCase().includes("trimestral") ? "quarterly" : "monthly";
}

// ✅ Gera um checkout InfinityPay novo pro user_id/plano, do mesmo jeito que
// infinitepay-create-checkout faz pro site — só que sem exigir sessão
// logada (o cron já sabe de quem é cada lembrete, direto do banco).
async function createInfinitepayCheckoutLink(
  userId: string,
  plan: "monthly" | "quarterly"
): Promise<string | null> {
  try {
    if (!INFINITEPAY_HANDLE || !INFINITEPAY_WEBHOOK_URL) return null;

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
  } catch (e) {
    console.error("[renewal-link] excecao ao gerar checkout:", String(e));
    return null;
  }
}

// ✅ Só gera link direto pra provider=infinitepay. Asaas/manual continuam
// recebendo o link genérico de sempre (LINK_DEFAULT) — não mexe nesses.
async function resolveRenewalLink(
  userId: string,
  provider: string,
  planName: string | null | undefined
): Promise<string> {
  if (provider !== "infinitepay") return LINK_DEFAULT;

  const plan = planFromName(planName);
  const checkoutUrl = await createInfinitepayCheckoutLink(userId, plan);
  if (!checkoutUrl) return LINK_DEFAULT;

  const token = base64UrlEncode(checkoutUrl);
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

  try {
    const results = [];
    results.push(await runBatch("renew_3d"));
    results.push(await runBatch("renew_1d"));
    // return_7d DESATIVADO - 0% de conversao

    return new Response(JSON.stringify({ ok: true, timezone: TZ, ran_at: new Date().toISOString(), results }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("fatal error", String(e));
    return new Response(JSON.stringify({ ok: false, timezone: TZ, ran_at: new Date().toISOString(), error: String(e) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
});
