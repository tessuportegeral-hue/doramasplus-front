// business-metrics-report: roda 1x/dia via pg_cron (9h BRT) e manda um email
// com números de negócio (cadastros, conversão, renovação, perda de acesso)
// + os mesmos números do painel /admin/analytics (mesma query, pra nunca
// divergir do que já é mostrado lá).
//
// Cadência de período:
// - Dia normal: números do DIA ANTERIOR.
// - Último dia do calendário (mês corrente): em vez do dia anterior, números
//   do MÊS INTEIRO (dia 1 até ontem).
// - Domingo: além da seção do dia, soma uma seção de SEMANA (últimos 7 dias
//   corridos, terminando ontem).
//
// Não corrige nada — só reporta (ver CLAUDE.md).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";
const CRON_SECRET = "dp_biz_metrics_w9k3r7";

const PRICE_MONTHLY = 15.9;
const PRICE_QUARTERLY = 43.9;

async function runSql(sql: string): Promise<any[]> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ q: sql }),
  });
  if (!resp.ok) throw new Error(`sql_failed: ${await resp.text().catch(() => "")}`);
  const data = await resp.json().catch(() => null);
  return Array.isArray(data) ? data : [];
}

// ===== datas em horário de Brasília (sem DST desde 2019, então é sempre UTC-3) =====
function getBrasiliaTodayParts(): { year: number; month: number; day: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), weekday: map.weekday };
}

function brtMidnightIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}T03:00:00.000Z`; // BRT 00:00 = UTC 03:00
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

type Period = { start: string; end: string; compareStart: string; compareEnd: string; label: string };

function buildDailyPeriod(today: { year: number; month: number; day: number }): Period {
  const todayStart = brtMidnightIso(today.year, today.month, today.day);
  const yestStart = addDaysIso(todayStart, -1);
  const dayBeforeStart = addDaysIso(todayStart, -2);
  return { start: yestStart, end: todayStart, compareStart: dayBeforeStart, compareEnd: yestStart, label: "Dia anterior" };
}

function buildMonthlyPeriod(today: { year: number; month: number; day: number }): Period {
  const todayStart = brtMidnightIso(today.year, today.month, today.day);
  const monthStart = brtMidnightIso(today.year, today.month, 1);
  const prevMonth = today.month === 1 ? 12 : today.month - 1;
  const prevMonthYear = today.month === 1 ? today.year - 1 : today.year;
  const prevMonthStart = brtMidnightIso(prevMonthYear, prevMonth, 1);
  return { start: monthStart, end: todayStart, compareStart: prevMonthStart, compareEnd: monthStart, label: "Mês inteiro" };
}

function buildWeeklyPeriod(today: { year: number; month: number; day: number }): Period {
  const todayStart = brtMidnightIso(today.year, today.month, today.day);
  const weekStart = addDaysIso(todayStart, -7);
  const compareStart = addDaysIso(todayStart, -14);
  return { start: weekStart, end: todayStart, compareStart, compareEnd: weekStart, label: "Últimos 7 dias" };
}

type Section = { title: string; html: string };

async function computeCustomMetrics(p: Period): Promise<{ signups: number; paidOfSignups: number; renewals: number; churned: number }> {
  const rows = await runSql(`
    with period as (select '${p.start}'::timestamptz as p_start, '${p.end}'::timestamptz as p_end),
    signups as (
      select id from profiles, period where created_at >= period.p_start and created_at < period.p_end
    ),
    paid_of_signups as (
      select count(*) as qtd from signups s where exists (select 1 from subscriptions sub where sub.user_id = s.id)
    ),
    renewals as (
      select count(distinct user_id) as qtd from subscription_renewals, period
      where is_renewal = true and renewed_at >= period.p_start and renewed_at < period.p_end
    ),
    churned as (
      select count(distinct user_id) as qtd from subscriptions, period
      where end_at >= period.p_start and end_at < period.p_end
        and status not in ('active','trialing')
    )
    select
      (select count(*) from signups) as signups,
      (select qtd from paid_of_signups) as paid_of_signups,
      (select qtd from renewals) as renewals,
      (select qtd from churned) as churned
  `);
  const r = rows[0] || {};
  return {
    signups: Number(r.signups || 0),
    paidOfSignups: Number(r.paid_of_signups || 0),
    renewals: Number(r.renewals || 0),
    churned: Number(r.churned || 0),
  };
}

// Mesma query do admin-analytics (src/pages/AdminAnalytics.jsx / edge function
// admin-analytics) — copiada pra bater 100% com o que aparece no painel.
async function computePanelMetrics(p: Period): Promise<any> {
  const revenueQuery = `
    with period as (
      select '${p.start}'::timestamptz as p_start, '${p.end}'::timestamptz as p_end
    ),
    pix as (
      select coalesce(sum(amount_cents),0)/100.0 as total, count(*) as qtd,
        count(*) filter (where plan = 'quarterly') as qtd_trimestral,
        count(*) filter (where plan <> 'quarterly' or plan is null) as qtd_mensal
      from pix_payments, period
      where status = 'paid' and provider in ('infinitepay','asaas')
        and created_at between period.p_start and period.p_end
    ),
    stripe_ren as (
      select
        count(*) filter (where coalesce(sr.plan_interval,'') = 'quarter' or coalesce(sr.plan_name,'') ilike '%trimestral%') as qtd_trimestral,
        count(*) filter (where not (coalesce(sr.plan_interval,'') = 'quarter' or coalesce(sr.plan_name,'') ilike '%trimestral%')) as qtd_mensal
      from subscription_renewals sr, period
      where sr.order_nsu is null
        and coalesce(sr.source,'') not in ('admin_manual','admin_quick_create')
        and sr.renewed_at between period.p_start and period.p_end
    ),
    manual_ren as (
      select
        coalesce(sum(extract(epoch from (sr.end_at - sr.start_at)) / 86400.0 / 30.0 * ${PRICE_MONTHLY}), 0) as total,
        count(*) as qtd
      from subscription_renewals sr, period
      where sr.source in ('admin_manual','admin_quick_create')
        and sr.renewed_at between period.p_start and period.p_end
        and sr.start_at is not null and sr.end_at is not null
    ),
    ativos as (
      select
        count(*) as total,
        count(*) filter (where coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%') as trimestral,
        count(*) filter (where not (coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%')) as mensal
      from subscriptions s
      where s.status in ('active','trialing','paid')
        and (
          (coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
          or coalesce(s.end_at, s.current_period_end) > now()
        )
    ),
    cohort_a as (
      select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
      from subscription_renewals sr, period
      where sr.renewed_at <= period.p_start
      order by sr.user_id, sr.renewed_at desc
    ),
    cohort_a_active as (
      select user_id from cohort_a, period
      where (end_at is null and provider is null) or end_at > period.p_start
    ),
    retained_a as (
      select ca.user_id
      from cohort_a_active ca
      join subscriptions s on s.user_id = ca.user_id, period
      where s.status in ('active','trialing','paid')
        and ( (coalesce(s.end_at,s.current_period_end) is null and s.provider is null)
              or coalesce(s.end_at,s.current_period_end) > period.p_end )
    ),
    new_a as (
      select count(distinct sr.user_id) as qtd
      from subscription_renewals sr, period
      where sr.is_renewal = false and sr.renewed_at between period.p_start and period.p_end
    ),
    compare_period as (
      select '${p.compareStart}'::timestamptz as c_start, '${p.compareEnd}'::timestamptz as c_end
    ),
    cohort_b as (
      select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
      from subscription_renewals sr, compare_period
      where sr.renewed_at <= compare_period.c_start
      order by sr.user_id, sr.renewed_at desc
    ),
    cohort_b_active as (
      select user_id from cohort_b, compare_period
      where (end_at is null and provider is null) or end_at > compare_period.c_start
    ),
    retained_b as (
      select cb.user_id
      from cohort_b_active cb
      join subscriptions s on s.user_id = cb.user_id, compare_period
      where s.status in ('active','trialing','paid')
        and ( (coalesce(s.end_at,s.current_period_end) is null and s.provider is null)
              or coalesce(s.end_at,s.current_period_end) > compare_period.c_end )
    ),
    new_b as (
      select count(distinct sr.user_id) as qtd
      from subscription_renewals sr, compare_period
      where sr.is_renewal = false and sr.renewed_at between compare_period.c_start and compare_period.c_end
    )
    select
      (select total from pix) as pix_total,
      (select qtd from pix) as pix_qtd,
      (select qtd_mensal from pix) as pix_qtd_mensal,
      (select qtd_trimestral from pix) as pix_qtd_trimestral,
      (select qtd_mensal * ${PRICE_MONTHLY} + qtd_trimestral * ${PRICE_QUARTERLY} from stripe_ren) as stripe_total,
      (select qtd_mensal from stripe_ren) as stripe_qtd_mensal,
      (select qtd_trimestral from stripe_ren) as stripe_qtd_trimestral,
      (select total from manual_ren) as manual_total,
      (select qtd from manual_ren) as manual_qtd,
      (select total from ativos) as ativos_total,
      (select mensal from ativos) as ativos_mensal,
      (select trimestral from ativos) as ativos_trimestral,
      (select count(*) from cohort_a_active) as churn_a_cohort,
      (select count(*) from retained_a) as churn_a_retained,
      (select qtd from new_a) as churn_a_new,
      (select count(*) from cohort_b_active) as churn_b_cohort,
      (select count(*) from retained_b) as churn_b_retained,
      (select qtd from new_b) as churn_b_new
  `;

  const rows = await runSql(revenueQuery);
  const rev = rows[0] || {};

  const pixTotal = Number(rev.pix_total || 0);
  const stripeTotal = Number(rev.stripe_total || 0);
  const manualTotal = Number(rev.manual_total || 0);

  const soldMonthly = Number(rev.pix_qtd_mensal || 0) + Number(rev.stripe_qtd_mensal || 0) + Number(rev.manual_qtd || 0);
  const soldQuarterly = Number(rev.pix_qtd_trimestral || 0) + Number(rev.stripe_qtd_trimestral || 0);
  const soldTotal = Number(rev.pix_qtd || 0) + Number(rev.stripe_qtd_mensal || 0) + Number(rev.stripe_qtd_trimestral || 0) + Number(rev.manual_qtd || 0);

  const pendingRows = await runSql(`select count(*) as qtd from pix_payments where status = 'pending'`);
  const pendingNow = Number(pendingRows[0]?.qtd || 0);

  const churnACohort = Number(rev.churn_a_cohort || 0);
  const churnARetained = Number(rev.churn_a_retained || 0);
  const churnBCohort = Number(rev.churn_b_cohort || 0);
  const churnBRetained = Number(rev.churn_b_retained || 0);

  return {
    sold_total: soldTotal,
    sold_monthly: soldMonthly,
    sold_quarterly: soldQuarterly,
    revenue_period: pixTotal + stripeTotal + manualTotal,
    revenue_breakdown: { pix_infinitepay_asaas: pixTotal, stripe_estimated: stripeTotal, manual_estimated: manualTotal },
    active_now: Number(rev.ativos_total || 0),
    active_now_monthly: Number(rev.ativos_mensal || 0),
    active_now_quarterly: Number(rev.ativos_trimestral || 0),
    pending_now: pendingNow,
    churn: {
      new: Number(rev.churn_a_new || 0),
      cohort: churnACohort,
      retained: churnARetained,
      churned: churnACohort - churnARetained,
      retention_rate: churnACohort > 0 ? Math.round((churnARetained / churnACohort) * 10000) / 100 : 0,
      compare: {
        new: Number(rev.churn_b_new || 0),
        cohort: churnBCohort,
        retained: churnBRetained,
        churned: churnBCohort - churnBRetained,
        retention_rate: churnBCohort > 0 ? Math.round((churnBRetained / churnBCohort) * 10000) / 100 : 0,
      },
    },
  };
}

function fmtBRL(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

function fmtDate(iso: string): string {
  // exibe em data BRT (yyyy-mm-dd) a partir do instante UTC-midnight-BRT construído
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function buildSection(p: Period): Promise<Section> {
  const [custom, panel] = await Promise.all([computeCustomMetrics(p), computePanelMetrics(p)]);
  const conversionRate = custom.signups > 0 ? Math.round((custom.paidOfSignups / custom.signups) * 10000) / 100 : 0;

  const html = `
    <div style="margin-bottom:20px;">
      <h3 style="color:#fff;margin:0 0 8px 0;">${p.label} (${fmtDate(p.start)} a ${fmtDate(addDaysIso(p.end, -1))})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#ddd;">
        <tr><td style="padding:4px 0;">📝 Cadastros novos</td><td style="text-align:right;font-weight:bold;">${custom.signups}</td></tr>
        <tr><td style="padding:4px 0;">💳 Desses, pagaram</td><td style="text-align:right;font-weight:bold;">${custom.paidOfSignups} (${conversionRate}%)</td></tr>
        <tr><td style="padding:4px 0;">🔄 Renovações</td><td style="text-align:right;font-weight:bold;">${custom.renewals}</td></tr>
        <tr><td style="padding:4px 0;">📉 Perderam assinatura ativa</td><td style="text-align:right;font-weight:bold;color:#e74c3c;">${custom.churned}</td></tr>
        <tr><td colspan="2" style="padding:10px 0 4px 0;border-top:1px solid #333;color:#888;font-size:11px;">Painel (mesma conta do /admin/analytics)</td></tr>
        <tr><td style="padding:4px 0;">💰 Faturamento do período</td><td style="text-align:right;font-weight:bold;">${fmtBRL(panel.revenue_period)}</td></tr>
        <tr><td style="padding:4px 0;">🧾 Vendas no período (mensal/trimestral)</td><td style="text-align:right;">${panel.sold_total} (${panel.sold_monthly}/${panel.sold_quarterly})</td></tr>
        <tr><td style="padding:4px 0;">✅ Assinantes ativos agora</td><td style="text-align:right;font-weight:bold;">${panel.active_now} (${panel.active_now_monthly} mensal / ${panel.active_now_quarterly} trimestral)</td></tr>
        <tr><td style="padding:4px 0;">⏳ Pix pendente agora</td><td style="text-align:right;">${panel.pending_now}</td></tr>
        <tr><td style="padding:4px 0;">📊 Retenção do período</td><td style="text-align:right;">${panel.churn.retention_rate}% (${panel.churn.retained}/${panel.churn.cohort}) — período anterior: ${panel.churn.compare.retention_rate}%</td></tr>
      </table>
    </div>`;

  return { title: p.label, html };
}

async function sendEmail(sections: Section[], subjectLabel: string) {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;padding:20px;">
      <h2 style="color:#fff;">📈 DoramasPlus — Relatório de negócio (${subjectLabel})</h2>
      ${sections.map((s) => s.html).join("")}
      <p style="color:#888;font-size:11px;margin-top:16px;">Gerado às ${new Date().toISOString()}.</p>
    </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: `📈 DoramasPlus — Relatório de negócio (${subjectLabel})`,
      html,
    }),
  }).catch((e) => console.error("[business-metrics-report] email fail:", String(e)));
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const today = getBrasiliaTodayParts();
  const isLastDay = today.day === lastDayOfMonth(today.year, today.month);
  const isSunday = today.weekday === "Sun";

  const mainPeriod = isLastDay ? buildMonthlyPeriod(today) : buildDailyPeriod(today);
  const sections: Section[] = [await buildSection(mainPeriod)];

  if (isSunday) {
    sections.push(await buildSection(buildWeeklyPeriod(today)));
  }

  const subjectLabel = isLastDay ? "mês inteiro" : isSunday ? "diário + semanal" : "diário";
  await sendEmail(sections, subjectLabel);

  return new Response(JSON.stringify({ ok: true, is_last_day: isLastDay, is_sunday: isSunday, sections: sections.map((s) => s.title) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
