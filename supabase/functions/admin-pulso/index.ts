import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ✅ 20/08 — dados do PULSO (/admin/pulso): dashboard financeiro com séries,
// funil e projeção. Separado do admin-analytics de propósito: as séries são
// mais pesadas (reconstrução de base mês a mês) e o painel clássico não
// precisa delas. Mesmas regras de negócio do admin-analytics v33:
// - faturamento = pix real (infinitepay/asaas, sem plan='series') + Stripe
//   estimado (15,90/43,90 — preço da época) por renovação
// - base ativa = mesma regra do gate de premium
// - renovações SEMPRE dedupadas por mês (subscription_renewals tem retry de
//   webhook, remigração 12-14/07 e Stripe+Asaas duplicado — ver memória)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const ADMIN_ID = '094e70c6-0671-4401-89fe-31aa5242348a';
const PRICE_MONTHLY = 17.9;
const PRICE_QUARTERLY = 49.9;
const STRIPE_PRICE_MONTHLY = 15.9;
const STRIPE_PRICE_QUARTERLY = 43.9;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'no_auth' }, 401);

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthenticated' }, 401);
    if (userData.user.id !== ADMIN_ID) return json({ error: 'forbidden' }, 403);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // ---- Série diária (90 dias, horário de Brasília) --------------------
    const dailyQuery = `
      with dias as (select generate_series((now() at time zone 'America/Sao_Paulo')::date - 89, (now() at time zone 'America/Sao_Paulo')::date, interval '1 day')::date d),
      pix_d as (
        select (created_at at time zone 'America/Sao_Paulo')::date d, sum(amount_cents)/100.0 fat, count(*) vendas
        from pix_payments where status='paid' and provider in ('infinitepay','asaas') and coalesce(plan,'')<>'series'
        group by 1),
      stripe_d as (
        select (renewed_at at time zone 'America/Sao_Paulo')::date d,
          sum(case when coalesce(plan_interval,'')='quarter' or coalesce(plan_name,'') ilike '%trimestral%' then ${STRIPE_PRICE_QUARTERLY} else ${STRIPE_PRICE_MONTHLY} end) fat,
          count(*) vendas
        from subscription_renewals where order_nsu is null and coalesce(source,'') not in ('admin_manual','admin_quick_create')
        group by 1),
      signups_d as (select (created_at at time zone 'America/Sao_Paulo')::date d, count(*) q from profiles group by 1)
      select dias.d::text as dia,
        round((coalesce(pix_d.fat,0)+coalesce(stripe_d.fat,0))::numeric,2) as fat,
        coalesce(pix_d.vendas,0)+coalesce(stripe_d.vendas,0) as vendas,
        coalesce(signups_d.q,0) as cadastros
      from dias
      left join pix_d on pix_d.d=dias.d
      left join stripe_d on stripe_d.d=dias.d
      left join signups_d on signups_d.d=dias.d
      order by 1
    `;

    // ---- Série mensal desde março (base reconstruída no fim de cada mês) --
    const monthlyQuery = `
      with meses as (select generate_series('2026-03-01'::date, date_trunc('month', now())::date, interval '1 month') m),
      fins as (select m, least(m + interval '1 month', now()) as m_end from meses),
      cov as (
        select f.m, count(*) as ativos_fim
        from fins f
        cross join lateral (
          select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
          from subscription_renewals sr
          where sr.renewed_at <= f.m_end
          order by sr.user_id, sr.renewed_at desc) u
        where (u.end_at is null and u.provider is null) or u.end_at > f.m_end
        group by f.m),
      novos as (
        select date_trunc('month', renewed_at) m, count(distinct user_id) q
        from subscription_renewals where is_renewal = false group by 1),
      renov as (
        select date_trunc('month', renewed_at) m, count(distinct user_id) q
        from subscription_renewals where is_renewal = true group by 1),
      fat_pix as (
        select date_trunc('month', created_at at time zone 'America/Sao_Paulo') m, sum(amount_cents)/100.0 fat
        from pix_payments where status='paid' and provider in ('infinitepay','asaas') and coalesce(plan,'')<>'series'
        group by 1),
      fat_str as (
        select date_trunc('month', renewed_at at time zone 'America/Sao_Paulo') m,
          sum(case when coalesce(plan_interval,'')='quarter' or coalesce(plan_name,'') ilike '%trimestral%' then ${STRIPE_PRICE_QUARTERLY} else ${STRIPE_PRICE_MONTHLY} end) fat
        from subscription_renewals where order_nsu is null and coalesce(source,'') not in ('admin_manual','admin_quick_create')
        group by 1)
      select to_char(f.m,'YYYY-MM') as mes,
        coalesce(c.ativos_fim,0) as base_fim,
        coalesce(n.q,0) as novos,
        coalesce(r.q,0) as renovadores,
        round((coalesce(fp.fat,0)+coalesce(fs.fat,0))::numeric,0) as fat
      from fins f
      left join cov c on c.m=f.m
      left join novos n on n.m=f.m
      left join renov r on r.m=f.m
      left join fat_pix fp on fp.m=f.m
      left join fat_str fs on fs.m=f.m
      order by 1
    `;

    // ---- Funil (composição por meses distintos de renovação, v33) --------
    const funnelQuery = `
      with ativos as (
        select s.user_id from subscriptions s
        where s.status in ('active','trialing','paid')
          and ((coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
               or coalesce(s.end_at, s.current_period_end) > now())
      ),
      contagem as (
        select a.user_id,
          (select count(distinct date_trunc('month', sr.renewed_at)) from subscription_renewals sr where sr.user_id = a.user_id and sr.is_renewal = true) as faixa
        from ativos a)
      select faixa, count(*) as qtd from contagem group by 1 order by 1
    `;

    // ---- Retenção por faixa (janela móvel 30d, mesma do analytics v33) ---
    const funnelRetQuery = `
      with period as (select now() - interval '30 days' as p_start, now() as p_end),
      cohort_a as (
        select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
        from subscription_renewals sr, period
        where sr.renewed_at <= period.p_start
        order by sr.user_id, sr.renewed_at desc),
      cohort_a_active as (
        select user_id from cohort_a, period
        where (end_at is null and provider is null) or end_at > period.p_start),
      tiered as (
        select ca.user_id,
          (select count(distinct date_trunc('month', sr.renewed_at)) from subscription_renewals sr, period where sr.user_id = ca.user_id and sr.is_renewal = true and sr.renewed_at <= period.p_start) as faixa
        from cohort_a_active ca, period),
      retained as (
        select t.user_id, t.faixa from tiered t
        join subscriptions s on s.user_id = t.user_id, period
        where s.status in ('active','trialing','paid')
          and ((coalesce(s.end_at,s.current_period_end) is null and s.provider is null)
               or coalesce(s.end_at,s.current_period_end) > period.p_end))
      select faixa, count(*) as cohort, (select count(*) from retained r where r.faixa = tiered.faixa) as retidos
      from tiered group by faixa order by faixa
    `;

    // ---- Retenção 30d ao longo do tempo (âncoras quinzenais) -------------
    // ✅ 20/08 v3 (pergunta do Stefano: "tô aumentando a retenção?").
    // Reconstrói dos renewals: coberto em T-30 e ainda coberto em T.
    const retSeriesQuery = `
      with anchors as (
        select generate_series('2026-04-30'::date, (now() at time zone 'America/Sao_Paulo')::date, interval '15 days')::timestamptz as t
      )
      select to_char(a.t, 'YYYY-MM-DD') as data, stats.cohort, stats.retidos
      from anchors a
      cross join lateral (
        with cohort as (
          select c.user_id from (
            select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
            from subscription_renewals sr
            where sr.renewed_at <= a.t - interval '30 days'
            order by sr.user_id, sr.renewed_at desc) c
          where (c.end_at is null and c.provider is null) or c.end_at > a.t - interval '30 days'
        ),
        agora as (
          select d.user_id from (
            select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
            from subscription_renewals sr
            where sr.renewed_at <= a.t
            order by sr.user_id, sr.renewed_at desc) d
          where (d.end_at is null and d.provider is null) or d.end_at > a.t
        )
        select (select count(*) from cohort) as cohort,
               (select count(*) from cohort co where exists (select 1 from agora ag where ag.user_id = co.user_id)) as retidos
      ) stats
      order by a.t
    `;

    // ---- KPIs (base ativa com split Stripe pro MRR) ----------------------
    // ✅ 20/08 v2: + novos_30d (1º pagamento, últimos 30 dias) — é o "ritmo
    // atual" DE VERDADE pro simulador. A média dos 2 últimos meses fechados
    // dava 1.641 enquanto o ritmo real era 830 (metade) e a projeção mostrava
    // crescimento com a base caindo — flagrado pelo Stefano.
    const kpiQuery = `
      select
        (select count(distinct user_id) from subscription_renewals where is_renewal = false and renewed_at > now() - interval '30 days') as novos_30d,
        count(*) as total,
        count(*) filter (where coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%') as trimestral,
        count(*) filter (where s.provider is null and not (coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%')) as stripe_mensal,
        count(*) filter (where s.provider is null and (coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%')) as stripe_trimestral
      from subscriptions s
      where s.status in ('active','trialing','paid')
        and ((coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
             or coalesce(s.end_at, s.current_period_end) > now())
    `;

    const [dailyRes, monthlyRes, funnelRes, funnelRetRes, kpiRes, retSeriesRes] = await Promise.all([
      admin.rpc('exec_sql', { q: dailyQuery }),
      admin.rpc('exec_sql', { q: monthlyQuery }),
      admin.rpc('exec_sql', { q: funnelQuery }),
      admin.rpc('exec_sql', { q: funnelRetQuery }),
      admin.rpc('exec_sql', { q: kpiQuery }),
      admin.rpc('exec_sql', { q: retSeriesQuery }),
    ]);

    for (const [name, res] of [['daily', dailyRes], ['monthly', monthlyRes], ['funnel', funnelRes], ['funnel_ret', funnelRetRes], ['kpi', kpiRes], ['ret_series', retSeriesRes]] as const) {
      if ((res as any).error) return json({ error: `${name}_query_failed`, details: (res as any).error }, 500);
    }

    const kpi = ((kpiRes.data as any[]) || [])[0] || {};
    const total = Number(kpi.total || 0);
    const trimestral = Number(kpi.trimestral || 0);
    const mensal = total - trimestral;
    const sm = Number(kpi.stripe_mensal || 0);
    const st = Number(kpi.stripe_trimestral || 0);
    const monthlyMrr = (mensal - sm) * PRICE_MONTHLY + sm * STRIPE_PRICE_MONTHLY;
    const quarterlyMrr = ((trimestral - st) * PRICE_QUARTERLY + st * STRIPE_PRICE_QUARTERLY) / 3;
    const mrr = Math.round((monthlyMrr + quarterlyMrr) * 100) / 100;

    return json({
      generated_at: new Date().toISOString(),
      daily: dailyRes.data || [],
      monthly: monthlyRes.data || [],
      funnel: funnelRes.data || [],
      funnel_retention: funnelRetRes.data || [],
      retention_series: retSeriesRes.data || [],
      kpis: {
        active_now: total,
        active_monthly: mensal,
        active_quarterly: trimestral,
        mrr,
        arpu: total > 0 ? Math.round((mrr / total) * 100) / 100 : 0,
        novos_30d: Number(kpi.novos_30d || 0),
      },
    });
  } catch (e) {
    return json({ error: 'internal', details: String(e) }, 500);
  }
});
