import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUser } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const WHATSAPP_WEBHOOK_BASE = Deno.env.get("WHATSAPP_WEBHOOK_BASE") || "";
const ZAP_ADMIN_SECRET = Deno.env.get("ZAP_ADMIN_SECRET") || "";

const LINK_DEFAULT = Deno.env.get("RENEWAL_LINK") || "www.doramasplus.com.br/plans";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

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

// ✅ 30/07: volta a mandar todo mundo pro /plans em vez de pré-gerar um
// checkout — pelo /plans a pessoa gera o Pix copia-e-cola direto ali,
// mais fácil que cair numa página hospedada externa (Asaas/InfinityPay).
async function resolveRenewalLink(): Promise<string> {
  return LINK_DEFAULT;
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

    const link = await resolveRenewalLink();

    // ✅ 25/07: push como canal extra, junto do WhatsApp — mesmo link direto.
    // Só dispara aqui (não duplica em email-renewal-reminder) pra não mandar
    // 2 push do mesmo aviso pro mesmo dia; se a pessoa não tiver assinatura
    // de push, sendPushToUser só retorna sent:0 sem erro.
    const pushTitle = kind === "renew_1d" ? "Seu acesso vence HOJE! ⚠️" : "Seu acesso vence em 3 dias! 💜";
    const pushBody =
      kind === "renew_1d"
        ? "Não perca seus doramas — renove agora mesmo."
        : "Renove agora e continue maratonando sem interrupção.";
    const pushUrl = link.startsWith("http") ? link : `https://${link}`;

    try {
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
