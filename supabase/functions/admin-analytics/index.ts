import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// mesmos precos usados no front (src/pages/AdminAnalytics.jsx)
const PRICE_MONTHLY = 15.9;
const PRICE_QUARTERLY = 43.9;

// valida e normaliza uma data recebida do body antes de embutir em SQL cru (exec_sql)
function safeIsoDate(value: unknown, fallback: Date): string {
  const d = new Date(String(value ?? ''));
  if (Number.isNaN(d.getTime())) return fallback.toISOString();
  return d.toISOString();
}

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

    const body = await req.json().catch(() => ({}));
    const periodStart = safeIsoDate(
      body?.period_start,
      new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    );
    const periodEnd = safeIsoDate(
      body?.period_end,
      new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59)
    );

    // ======================================================================
    // Faturamento do periodo, somando as origens de pagamento:
    // - InfinityPay (site) + Asaas (bot)  -> pix_payments.amount_cents (valor real)
    // - Stripe                            -> subscription_renewals (evento de
    //   renovacao), preco estimado por plano (mensal/trimestral)
    // - PIX manual recebido pelo admin     -> subscription_renewals, valor
    //   estimado proporcional aos dias concedidos (start_at -> end_at)
    //
    // Usa exec_sql (agregacao no banco) em vez de puxar as linhas e somar em
    // JS: com >1000 pagamentos no periodo, o limite padrao de linhas do
    // PostgREST cortava o resultado e o faturamento parava de subir (~17k).
    // ======================================================================
    const revenueQuery = `
      with period as (
        select '${periodStart}'::timestamptz as p_start, '${periodEnd}'::timestamptz as p_end
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
      -- Assinantes ativos AGORA (independe do periodo filtrado acima).
      -- Espelha a mesma regra do gate de premium (SupabaseAuthContext.checkPremiumStatus):
      -- status em active/trialing/paid E (sem data + provider Stripe, ou data no futuro).
      -- Antes usava .gt('end_at', now) direto no front, que exclui quem tem end_at nulo
      -- (Stripe sem data fixa) e classificava mensal/trimestral só por ilike no plan_name
      -- (muita linha antiga tem plan_name nulo e nao batia em nada).
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
        (select trimestral from ativos) as ativos_trimestral
    `;

    const { data: revRows, error: revErr } = await admin.rpc('exec_sql', { q: revenueQuery });
    if (revErr) return json({ error: 'revenue_query_failed', details: revErr }, 500);

    const rev = (revRows && revRows[0]) || {};
    const pixTotal = Number(rev.pix_total || 0);
    const stripeTotal = Number(rev.stripe_total || 0);
    const manualTotal = Number(rev.manual_total || 0);

    const soldMonthly =
      Number(rev.pix_qtd_mensal || 0) + Number(rev.stripe_qtd_mensal || 0) + Number(rev.manual_qtd || 0);
    const soldQuarterly = Number(rev.pix_qtd_trimestral || 0) + Number(rev.stripe_qtd_trimestral || 0);
    const soldTotal =
      Number(rev.pix_qtd || 0) +
      Number(rev.stripe_qtd_mensal || 0) +
      Number(rev.stripe_qtd_trimestral || 0) +
      Number(rev.manual_qtd || 0);

    // PIX pendentes agora
    const { count: pendingNow } = await admin
      .from('pix_payments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    // PIX pendentes no periodo
    const { count: pendingInPeriod } = await admin
      .from('pix_payments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd);

    // Retenção D30 (continua baseada em PIX, igual antes)
    const d30Start = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const d30End = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const d30Recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: d30BaseData } = await admin
      .from('pix_payments')
      .select('user_id')
      .eq('status', 'paid')
      .gte('created_at', d30Start)
      .lte('created_at', d30End);

    const d30BaseIds = [...new Set((d30BaseData || []).map((r: any) => r.user_id))];

    const { data: d30RetainedData } = await admin
      .from('pix_payments')
      .select('user_id')
      .eq('status', 'paid')
      .gte('created_at', d30Recent)
      .in('user_id', d30BaseIds.length > 0 ? d30BaseIds : ['no-match']);

    const d30Retained = new Set((d30RetainedData || []).map((r: any) => r.user_id)).size;
    const d30Base = d30BaseIds.length;
    const d30Rate = d30Base > 0 ? Math.round((d30Retained / d30Base) * 10000) / 100 : 0;

    return json({
      sold_total: soldTotal,
      sold_monthly: soldMonthly,
      sold_quarterly: soldQuarterly,
      revenue_period: pixTotal + stripeTotal + manualTotal,
      revenue_breakdown: {
        pix_infinitepay_asaas: pixTotal,
        stripe_estimated: stripeTotal,
        manual_estimated: manualTotal,
      },
      active_now: Number(rev.ativos_total || 0),
      active_now_monthly: Number(rev.ativos_mensal || 0),
      active_now_quarterly: Number(rev.ativos_trimestral || 0),
      pending_now: pendingNow || 0,
      pending_in_period: pendingInPeriod || 0,
      d30_base: d30Base,
      d30_retained: d30Retained,
      d30_rate: d30Rate,
    });
  } catch (e) {
    return json({ error: 'internal', details: String(e) }, 500);
  }
});
