// business-metrics-report: roda 1x/dia via pg_cron (9h BRT) e manda um email
// com números de negócio (cadastros, conversão, renovação, perda de acesso)
// + os mesmos números do painel /admin/analytics (mesma query, pra nunca
// divergir do que já é mostrado lá) + uma opinião gerada por IA (Claude,
// mesma chave usada no dora-chat) sobre o momento do negócio.
//
// Cadência de período:
// - Dia normal: números do DIA ANTERIOR.
// - Dia 1 do mês: em vez do dia anterior, números do MÊS INTEIRO ANTERIOR
//   (mês fechado, dados completos — antes era no último dia do mês, mas aí
//   faltava o próprio dia).
// - Domingo: além da seção do dia, soma uma seção de SEMANA (últimos 7 dias
//   corridos, terminando ontem).
//
// Não corrige nada — só reporta (ver CLAUDE.md).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
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

type Period = { start: string; end: string; compareStart: string; compareEnd: string; label: string };

function buildDailyPeriod(today: { year: number; month: number; day: number }): Period {
  const todayStart = brtMidnightIso(today.year, today.month, today.day);
  const yestStart = addDaysIso(todayStart, -1);
  const dayBeforeStart = addDaysIso(todayStart, -2);
  return { start: yestStart, end: todayStart, compareStart: dayBeforeStart, compareEnd: yestStart, label: "Dia anterior" };
}

function buildMonthlyPeriodForMonth(year: number, month: number): Period {
  const start = brtMidnightIso(year, month, 1);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = brtMidnightIso(nextYear, nextMonth, 1);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const compareStart = brtMidnightIso(prevYear, prevMonth, 1);
  return { start, end, compareStart, compareEnd: start, label: "Mês inteiro" };
}

// ✅ 01/08: dispara no DIA 1 do mês (não mais no último dia) — assim o mês
// reportado já está totalmente fechado, sem faltar o próprio dia.
function buildMonthlyPeriod(today: { year: number; month: number; day: number }): Period {
  const prevMonth = today.month === 1 ? 12 : today.month - 1;
  const prevMonthYear = today.month === 1 ? today.year - 1 : today.year;
  return buildMonthlyPeriodForMonth(prevMonthYear, prevMonth);
}

function buildWeeklyPeriod(today: { year: number; month: number; day: number }): Period {
  const todayStart = brtMidnightIso(today.year, today.month, today.day);
  const weekStart = addDaysIso(todayStart, -7);
  const compareStart = addDaysIso(todayStart, -14);
  return { start: weekStart, end: todayStart, compareStart, compareEnd: weekStart, label: "Últimos 7 dias" };
}

type Section = { title: string; html: string; forOpinion: Record<string, unknown> };

async function computeCustomMetrics(p: Period): Promise<{ signups: number; paidOfSignups: number; renewals: number; churned: number; winback: number }> {
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
    -- ⚠️ 01/08 fix: churned_users NÃO pode vir da tabela subscriptions (ela é
    -- sobrescrita a cada pagamento — quando alguém renova, o registro antigo
    -- de quem "perdeu" desaparece, e o winback nunca encontra ninguém). Usa
    -- subscription_renewals (histórico, nunca muda) e congela o estado
    -- exatamente no fim do período, igual o painel faz pra retenção.
    cohort_start as (
      select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
      from subscription_renewals sr, period
      where sr.renewed_at <= period.p_start
      order by sr.user_id, sr.renewed_at desc
    ),
    cohort_active_at_start as (
      select user_id from cohort_start, period
      where (end_at is null and provider is null) or end_at > period.p_start
    ),
    last_by_period_end as (
      select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
      from subscription_renewals sr, period
      where sr.user_id in (select user_id from cohort_active_at_start)
        and sr.renewed_at < period.p_end
      order by sr.user_id, sr.renewed_at desc
    ),
    churned_users as (
      select user_id from last_by_period_end, period
      where not ((end_at is null and provider is null) or end_at > period.p_end)
    ),
    winback as (
      -- de quem perdeu assinatura ativa no período (congelado no fim do
      -- período), quantos JÁ VOLTARAM a pagar DEPOIS do período fechar —
      -- esse número só cresce com o tempo, nunca diminui.
      select count(distinct cu.user_id) as qtd
      from churned_users cu, period
      where exists (
        select 1 from subscription_renewals sr2
        where sr2.user_id = cu.user_id
          and sr2.is_renewal = true
          and sr2.renewed_at >= period.p_end
      )
    )
    select
      (select count(*) from signups) as signups,
      (select qtd from paid_of_signups) as paid_of_signups,
      (select qtd from renewals) as renewals,
      (select count(*) from churned_users) as churned,
      (select qtd from winback) as winback
  `);
  const r = rows[0] || {};
  return {
    signups: Number(r.signups || 0),
    paidOfSignups: Number(r.paid_of_signups || 0),
    renewals: Number(r.renewals || 0),
    churned: Number(r.churned || 0),
    winback: Number(r.winback || 0),
  };
}

// Mesma query do admin-analytics (src/pages/AdminAnalytics.jsx / edge function
// admin-analytics) — copiada pra bater 100% com o que aparece no painel.
async function computePanelMetrics(p: Period): Promise<any> {
  const revenueQuery = `
    with period as (
      select '${p.start}'::timestamptz as p_start, '${p.end}'::timestamptz as p_end
    ),
    -- ✅ 01/08 fix: venda avulsa de série (R$10, plan='series', bot
    -- WhatsApp) não é assinatura — não pode entrar no faturamento nem nas
    -- "vendas mensal" desse relatório.
    pix as (
      select coalesce(sum(amount_cents),0)/100.0 as total, count(*) as qtd,
        count(*) filter (where plan = 'quarterly') as qtd_trimestral,
        count(*) filter (where plan <> 'quarterly' or plan is null) as qtd_mensal
      from pix_payments, period
      where status = 'paid' and provider in ('infinitepay','asaas')
        and coalesce(plan,'') <> 'series'
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
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function buildSection(p: Period): Promise<Section> {
  const [custom, panel] = await Promise.all([computeCustomMetrics(p), computePanelMetrics(p)]);

  const conversionRate = custom.signups > 0 ? Math.round((custom.paidOfSignups / custom.signups) * 10000) / 100 : 0;
  // ✅ 01/08: índice de reposição = renovações vs. churn do MESMO período
  // (não necessariamente as mesmas pessoas — ver winbackRate abaixo pra
  // taxa real de recuperação de quem perdeu).
  const renewalRate = custom.churned > 0 ? Math.round((custom.renewals / custom.churned) * 10000) / 100 : custom.renewals > 0 ? 100 : 0;
  // ✅ 01/08: taxa real de recuperação — acompanha o MESMO grupo de quem
  // perdeu assinatura ativa no período e mede quantos desses já voltaram a
  // pagar (medido até agora, então tende a subir com o tempo pra meses recentes).
  const winbackRate = custom.churned > 0 ? Math.round((custom.winback / custom.churned) * 10000) / 100 : 0;
  // ✅ 01/08: taxa de churn do período = % de quem TINHA assinatura ativa no
  // início do período e perdeu até o fim dele (mesmo cohort/mesma conta que
  // o painel usa pra retenção — é só o complemento: churn% = 100 - retenção%).
  const churnRate = panel.churn.cohort > 0 ? Math.round((panel.churn.churned / panel.churn.cohort) * 10000) / 100 : 0;
  const churnRateCompare = panel.churn.compare.cohort > 0 ? Math.round((panel.churn.compare.churned / panel.churn.compare.cohort) * 10000) / 100 : 0;

  const html = `
    <div style="margin-bottom:20px;">
      <h3 style="color:#fff;margin:0 0 8px 0;">${p.label} (${fmtDate(p.start)} a ${fmtDate(addDaysIso(p.end, -1))})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#ddd;">
        <tr><td style="padding:4px 0;">📝 Cadastros novos</td><td style="text-align:right;font-weight:bold;">${custom.signups}</td></tr>
        <tr><td style="padding:4px 0;">💳 Desses, pagaram</td><td style="text-align:right;font-weight:bold;">${custom.paidOfSignups} (${conversionRate}%)</td></tr>
        <tr><td style="padding:4px 0;">📉 Perderam assinatura ativa</td><td style="text-align:right;font-weight:bold;color:#e74c3c;">${custom.churned}</td></tr>
        <tr><td style="padding:4px 0;">🔄 Renovações no período (índice de reposição)</td><td style="text-align:right;font-weight:bold;">${custom.renewals} (${renewalRate}% vs. quem perdeu no período)</td></tr>
        <tr><td style="padding:4px 0;">♻️ Taxa real de recuperação</td><td style="text-align:right;font-weight:bold;color:#2ecc71;">${winbackRate}% (${custom.winback}/${custom.churned} de quem perdeu já voltou a pagar)</td></tr>
        <tr><td colspan="2" style="padding:10px 0 4px 0;border-top:1px solid #333;color:#888;font-size:11px;">Painel (mesma conta do /admin/analytics)</td></tr>
        <tr><td style="padding:4px 0;">💰 Faturamento do período</td><td style="text-align:right;font-weight:bold;">${fmtBRL(panel.revenue_period)}</td></tr>
        <tr><td style="padding:4px 0;">🧾 Vendas no período (mensal/trimestral)</td><td style="text-align:right;">${panel.sold_total} (${panel.sold_monthly}/${panel.sold_quarterly})</td></tr>
        <tr><td style="padding:4px 0;">✅ Assinantes ativos agora</td><td style="text-align:right;font-weight:bold;">${panel.active_now} (${panel.active_now_monthly} mensal / ${panel.active_now_quarterly} trimestral)</td></tr>
        <tr><td style="padding:4px 0;">⏳ Pix pendente agora</td><td style="text-align:right;">${panel.pending_now}</td></tr>
        <tr><td style="padding:4px 0;">📊 Retenção do período</td><td style="text-align:right;">${panel.churn.retention_rate}% (${panel.churn.retained}/${panel.churn.cohort}) — período anterior: ${panel.churn.compare.retention_rate}%</td></tr>
        <tr><td style="padding:4px 0;">🔻 Taxa de churn do período</td><td style="text-align:right;font-weight:bold;color:#e74c3c;">${churnRate}% (${panel.churn.churned}/${panel.churn.cohort}) — período anterior: ${churnRateCompare}%</td></tr>
      </table>
    </div>`;

  return {
    title: p.label,
    html,
    forOpinion: {
      periodo: p.label,
      cadastros: custom.signups,
      pagaram: custom.paidOfSignups,
      taxa_conversao_pct: conversionRate,
      renovacoes: custom.renewals,
      taxa_reposicao_pct: renewalRate,
      perderam_assinatura: custom.churned,
      recuperaram_apos_perda: custom.winback,
      taxa_recuperacao_real_pct: winbackRate,
      faturamento: panel.revenue_period,
      assinantes_ativos_agora: panel.active_now,
      taxa_retencao_pct: panel.churn.retention_rate,
      taxa_retencao_periodo_anterior_pct: panel.churn.compare.retention_rate,
      taxa_churn_pct: churnRate,
      taxa_churn_periodo_anterior_pct: churnRateCompare,
    },
  };
}

async function generateOpinion(sectionsData: Record<string, unknown>[]): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const prompt = `Você é um analista de negócios experiente olhando os números de uma plataforma de streaming de doramas por assinatura (DoramasPlus). Aqui estão os números do período mais recente (em JSON):\n\n${JSON.stringify(sectionsData, null, 2)}\n\nEscreva uma opinião curta (3 a 5 frases, em português do Brasil, tom direto e prático) sobre como está o momento do negócio: o que está indo bem, o que preocupa, e se fizer sentido, UMA sugestão concreta de onde focar atenção. Não repita os números crus (já aparecem em tabela antes disso), foque na interpretação. Não use markdown, só texto corrido.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error("[business-metrics-report] anthropic error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json().catch(() => ({}));
    const text = data?.content?.[0]?.text;
    return typeof text === "string" ? text.trim() : null;
  } catch (e) {
    console.error("[business-metrics-report] generateOpinion fail:", String(e));
    return null;
  }
}

async function sendEmail(sections: Section[], subjectLabel: string) {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  const opinion = await generateOpinion(sections.map((s) => s.forOpinion));
  const opinionHtml = opinion
    ? `<div style="margin-bottom:20px;padding:14px;background:#161616;border:1px solid #333;border-radius:8px;">
        <div style="color:#e74c3c;font-size:12px;font-weight:bold;margin-bottom:6px;">🤖 Opinião (gerada por IA a partir dos números acima)</div>
        <div style="color:#ddd;font-size:13px;line-height:1.6;">${opinion.replace(/\n/g, "<br>")}</div>
      </div>`
    : "";
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;padding:20px;">
      <h2 style="color:#fff;">📈 DoramasPlus — Relatório de negócio (${subjectLabel})</h2>
      ${sections.map((s) => s.html).join("")}
      ${opinionHtml}
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

  // ✅ 01/08: força o tipo de período pra facilitar testar/conferir preview
  // sem esperar a data real (ex.: ver o "mês inteiro" sem ser dia 1). month/
  // year opcionais junto de force_period:"monthly" pra mirar um mês
  // específico (senão usa o mês anterior ao de hoje). Uso normal do cron
  // não manda body, cai no auto-detect por data.
  const body = await req.json().catch(() => ({}));
  const forcePeriod = typeof body?.force_period === "string" ? body.force_period : null;
  const forceMonth = typeof body?.month === "number" ? body.month : null;
  const forceYear = typeof body?.year === "number" ? body.year : null;

  const today = getBrasiliaTodayParts();
  const isFirstDay = forcePeriod ? forcePeriod === "monthly" : today.day === 1;
  const isSunday = forcePeriod ? forcePeriod === "weekly" : today.weekday === "Sun";

  const mainPeriod = isFirstDay
    ? forceMonth && forceYear
      ? buildMonthlyPeriodForMonth(forceYear, forceMonth)
      : buildMonthlyPeriod(today)
    : buildDailyPeriod(today);
  const sections: Section[] = [await buildSection(mainPeriod)];

  if (isSunday) {
    sections.push(await buildSection(buildWeeklyPeriod(today)));
  }

  const subjectLabel = isFirstDay ? "mês inteiro" : isSunday ? "diário + semanal" : "diário";
  await sendEmail(sections, subjectLabel);

  return new Response(JSON.stringify({ ok: true, is_first_day: isFirstDay, is_sunday: isSunday, sections: sections.map((s) => s.title) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
