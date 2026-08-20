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

// ✅ 19/08 fix de preço: o painel calculava MRR/estimativas com 15,90 desde
// sempre — mas o mensal PIX é 17,90 desde ~27/07 (e o trimestral 49,90).
// O MRR mostrado ficava ~R$ 4 mil/mês ABAIXO do real. Stripe é caso à parte:
// assinatura antiga do Stripe continua cobrando o preço da época (15,90 /
// 43,90) — por isso constantes separadas, usadas nas estimativas do Stripe
// e no MRR dos ativos com provider null (= Stripe legado, 302 contas em 19/08).
const PRICE_MONTHLY = 17.9;
const PRICE_QUARTERLY = 49.9;
const STRIPE_PRICE_MONTHLY = 15.9;
const STRIPE_PRICE_QUARTERLY = 43.9;

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

    // periodo de comparacao (churn/retencao) - por padrao, o mes de calendario
    // imediatamente anterior ao inicio do periodo principal
    const defaultCompareStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const defaultCompareEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0, 23, 59, 59);
    const comparePeriodStart = safeIsoDate(body?.compare_period_start, defaultCompareStart);
    const comparePeriodEnd = safeIsoDate(body?.compare_period_end, defaultCompareEnd);

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
      -- ✅ 01/08 fix: venda avulsa de série (R$10, plan='series', bot
      -- WhatsApp) não é assinatura — nunca cria linha em subscriptions,
      -- só entrega o link e some. Mas essa query não excluía plan='series',
      -- então ela inflava o faturamento E entrava contada como "vendas
      -- mensal" (plan <> 'quarterly' pegava 'series' também).
      pix as (
        select coalesce(sum(amount_cents),0)/100.0 as total, count(*) as qtd,
          count(*) filter (where plan = 'quarterly') as qtd_trimestral,
          count(*) filter (where plan <> 'quarterly' or plan is null) as qtd_mensal
        from pix_payments, period
        where status = 'paid' and provider in ('infinitepay','asaas')
          and coalesce(plan,'') <> 'series'
          and created_at between period.p_start and period.p_end
      ),
      -- ✅ 04/08: vendas avulsas de R$10 (plan='series', link único via bot
      -- WhatsApp) contadas À PARTE — de propósito NÃO entram no faturamento
      -- acima (pix CTE já exclui plan='series'). user_id/whatsapp_conversation_id
      -- sempre nulos nessas linhas; telefone do comprador vem embutido em
      -- order_nsu como "salesbot_asaas|<telefone>|series|<timestamp>", por
      -- isso conta pessoa distinta via split_part.
      avulso as (
        select coalesce(sum(amount_cents),0)/100.0 as total,
          count(*) as qtd_vendas,
          count(distinct split_part(order_nsu, '|', 2)) as qtd_pessoas
        from pix_payments, period
        where status = 'paid' and provider in ('infinitepay','asaas')
          and plan = 'series'
          and created_at between period.p_start and period.p_end
      ),
      -- ✅ 05/08: separa as vendas de assinatura (mesmo universo da CTE
      -- "pix" acima — infinitepay+asaas, sem venda avulsa) por canal, usando
      -- pix_payments.source (não dá pra usar "provider": Asaas hoje atende
      -- tanto o bot quanto vendas diretas do site, então provider sozinho
      -- mistura os dois). "bot" = veio da conversa com o bot de vendas do
      -- WhatsApp; "site" = todo o resto (checkout direto, ads, lembretes de
      -- renovação por WhatsApp/email, Dora chat, linhas antigas sem source).
      canal as (
        select
          count(*) filter (where source = 'whatsapp_sales_bot') as bot_qtd,
          count(*) filter (where source = 'whatsapp_sales_bot' and plan = 'quarterly') as bot_trimestral,
          count(*) filter (where source = 'whatsapp_sales_bot' and (plan <> 'quarterly' or plan is null)) as bot_mensal,
          coalesce(sum(amount_cents) filter (where source = 'whatsapp_sales_bot'),0)/100.0 as bot_total_reais,
          count(*) filter (where source is distinct from 'whatsapp_sales_bot') as site_pix_qtd,
          count(*) filter (where source is distinct from 'whatsapp_sales_bot' and plan = 'quarterly') as site_pix_trimestral,
          count(*) filter (where source is distinct from 'whatsapp_sales_bot' and (plan <> 'quarterly' or plan is null)) as site_pix_mensal,
          coalesce(sum(amount_cents) filter (where source is distinct from 'whatsapp_sales_bot'),0)/100.0 as site_pix_total_reais
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
          count(*) filter (where not (coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%')) as mensal,
          -- ✅ 19/08: split Stripe (provider null = legado, paga preço antigo)
          -- x resto (PIX, paga preço vigente) pro MRR sair certo
          count(*) filter (where s.provider is null and not (coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%')) as stripe_mensal,
          count(*) filter (where s.provider is null and (coalesce(plan_interval,'') = 'quarter' or coalesce(plan_name,'') ilike '%trimestral%')) as stripe_trimestral
        from subscriptions s
        where s.status in ('active','trialing','paid')
          and (
            (coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
            or coalesce(s.end_at, s.current_period_end) > now()
          )
      ),
      -- Entraram / sairam / retencao no periodo principal (A) e no de comparacao (B).
      -- "Cohort no inicio de X" = pra cada usuario, pega o evento de renovacao mais
      -- recente registrado ATE o inicio de X (subscription_renewals so loga quando
      -- status vira 'active', entao isso reconstroi quem estava coberto naquele
      -- instante). "Retido no fim de X" = confere no estado ATUAL da assinatura se
      -- a cobertura ainda passa do fim de X (mesma regra do gate de premium).
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
      -- ✅ 01/08: "taxa real de recuperação" — de quem tinha assinatura ativa
      -- no início do período e a perdeu, quantos JÁ VOLTARAM a pagar DEPOIS
      -- do período fechar. Precisa congelar quem perdeu usando o HISTÓRICO
      -- (subscription_renewals, nunca muda) em vez da tabela subscriptions
      -- (mutável — se usasse ela, quem já voltou some da lista de "perdeu" e
      -- a recuperação nunca aparece, mesmo quando existe de verdade).
      last_by_period_end_a as (
        select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
        from subscription_renewals sr, period
        where sr.user_id in (select user_id from cohort_a_active)
          and sr.renewed_at < period.p_end
        order by sr.user_id, sr.renewed_at desc
      ),
      churned_users_a as (
        select user_id from last_by_period_end_a, period
        where not ((end_at is null and provider is null) or end_at > period.p_end)
      ),
      winback_a as (
        select count(distinct cu.user_id) as qtd
        from churned_users_a cu, period
        where exists (
          select 1 from subscription_renewals sr2
          where sr2.user_id = cu.user_id and sr2.is_renewal = true and sr2.renewed_at >= period.p_end
        )
      ),
      compare_period as (
        select '${comparePeriodStart}'::timestamptz as c_start, '${comparePeriodEnd}'::timestamptz as c_end
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
      ),
      last_by_period_end_b as (
        select distinct on (sr.user_id) sr.user_id, sr.end_at, sr.provider
        from subscription_renewals sr, compare_period
        where sr.user_id in (select user_id from cohort_b_active)
          and sr.renewed_at < compare_period.c_end
        order by sr.user_id, sr.renewed_at desc
      ),
      churned_users_b as (
        select user_id from last_by_period_end_b, compare_period
        where not ((end_at is null and provider is null) or end_at > compare_period.c_end)
      ),
      winback_b as (
        select count(distinct cu.user_id) as qtd
        from churned_users_b cu, compare_period
        where exists (
          select 1 from subscription_renewals sr2
          where sr2.user_id = cu.user_id and sr2.is_renewal = true and sr2.renewed_at >= compare_period.c_end
        )
      )
      select
        (select total from pix) as pix_total,
        (select qtd from pix) as pix_qtd,
        (select qtd_mensal from pix) as pix_qtd_mensal,
        (select qtd_trimestral from pix) as pix_qtd_trimestral,
        (select total from avulso) as avulso_total,
        (select qtd_vendas from avulso) as avulso_qtd_vendas,
        (select qtd_pessoas from avulso) as avulso_qtd_pessoas,
        (select bot_qtd from canal) as bot_qtd,
        (select bot_mensal from canal) as bot_mensal,
        (select bot_trimestral from canal) as bot_trimestral,
        (select bot_total_reais from canal) as bot_total_reais,
        (select site_pix_qtd from canal) as site_pix_qtd,
        (select site_pix_mensal from canal) as site_pix_mensal,
        (select site_pix_trimestral from canal) as site_pix_trimestral,
        (select site_pix_total_reais from canal) as site_pix_total_reais,
        (select qtd_mensal * ${STRIPE_PRICE_MONTHLY} + qtd_trimestral * ${STRIPE_PRICE_QUARTERLY} from stripe_ren) as stripe_total,
        (select qtd_mensal from stripe_ren) as stripe_qtd_mensal,
        (select qtd_trimestral from stripe_ren) as stripe_qtd_trimestral,
        (select total from manual_ren) as manual_total,
        (select qtd from manual_ren) as manual_qtd,
        (select total from ativos) as ativos_total,
        (select mensal from ativos) as ativos_mensal,
        (select trimestral from ativos) as ativos_trimestral,
        (select stripe_mensal from ativos) as ativos_stripe_mensal,
        (select stripe_trimestral from ativos) as ativos_stripe_trimestral,
        (select count(*) from cohort_a_active) as churn_a_cohort,
        (select count(*) from retained_a) as churn_a_retained,
        (select qtd from new_a) as churn_a_new,
        (select count(*) from cohort_b_active) as churn_b_cohort,
        (select count(*) from retained_b) as churn_b_retained,
        (select qtd from new_b) as churn_b_new,
        (select count(*) from churned_users_a) as churn_a_frozen_churned,
        (select qtd from winback_a) as churn_a_winback,
        (select count(*) from churned_users_b) as churn_b_frozen_churned,
        (select qtd from winback_b) as churn_b_winback
    `;

    const { data: revRows, error: revErr } = await admin.rpc('exec_sql', { q: revenueQuery });
    if (revErr) return json({ error: 'revenue_query_failed', details: revErr }, 500);

    const rev = (revRows && revRows[0]) || {};
    const pixTotal = Number(rev.pix_total || 0);
    const stripeTotal = Number(rev.stripe_total || 0);
    const manualTotal = Number(rev.manual_total || 0);
    const avulsoTotal = Number(rev.avulso_total || 0);
    const avulsoQtdVendas = Number(rev.avulso_qtd_vendas || 0);
    const avulsoQtdPessoas = Number(rev.avulso_qtd_pessoas || 0);

    const soldMonthly =
      Number(rev.pix_qtd_mensal || 0) + Number(rev.stripe_qtd_mensal || 0) + Number(rev.manual_qtd || 0);
    const soldQuarterly = Number(rev.pix_qtd_trimestral || 0) + Number(rev.stripe_qtd_trimestral || 0);
    const soldTotal =
      Number(rev.pix_qtd || 0) +
      Number(rev.stripe_qtd_mensal || 0) +
      Number(rev.stripe_qtd_trimestral || 0) +
      Number(rev.manual_qtd || 0);

    // ✅ 05/08: vendas por canal (bot do WhatsApp x site) — bot é sempre
    // pix_payments.source = 'whatsapp_sales_bot'; Stripe e PIX manual do
    // admin nunca passam pelo bot, então entram inteiros como "site".
    const botMensal = Number(rev.bot_mensal || 0);
    const botTrimestral = Number(rev.bot_trimestral || 0);
    const botQtd = Number(rev.bot_qtd || 0);
    const botTotalReais = Number(rev.bot_total_reais || 0);

    const sitePixMensal = Number(rev.site_pix_mensal || 0);
    const sitePixTrimestral = Number(rev.site_pix_trimestral || 0);
    const sitePixQtd = Number(rev.site_pix_qtd || 0);
    const sitePixTotalReais = Number(rev.site_pix_total_reais || 0);

    const siteMensal = sitePixMensal + Number(rev.stripe_qtd_mensal || 0) + Number(rev.manual_qtd || 0);
    const siteTrimestral = sitePixTrimestral + Number(rev.stripe_qtd_trimestral || 0);
    const siteQtd =
      sitePixQtd + Number(rev.stripe_qtd_mensal || 0) + Number(rev.stripe_qtd_trimestral || 0) + Number(rev.manual_qtd || 0);
    const siteTotalReais = sitePixTotalReais + stripeTotal + manualTotal;

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

    // ✅ 19/08 fix: Retenção D30 mostrava 0,00% há tempos — a versão antiga
    // puxava a base (700+ user_ids) e passava tudo num .in() do PostgREST:
    // a URL estourava, o erro era ENGOLIDO (data null) e "retidos" virava 0.
    // Mesma família do bug que matou o email-reengagement por 2 meses.
    // Agora é UMA query agregada no banco.
    const { data: d30Rows, error: d30Err } = await admin.rpc('exec_sql', {
      q: `
      with base as (
        select distinct user_id from pix_payments
        where status = 'paid' and user_id is not null
          and created_at between now() - interval '60 days' and now() - interval '30 days'
      ),
      ret as (
        select distinct p.user_id from pix_payments p
        join base b on b.user_id = p.user_id
        where p.status = 'paid' and p.created_at > now() - interval '30 days'
      )
      select (select count(*) from base) as d30_base, (select count(*) from ret) as d30_retained
    ` });
    if (d30Err) console.error('[admin-analytics] d30_query_failed:', d30Err);
    const d30Row = (d30Rows && d30Rows[0]) || {};
    const d30Base = Number(d30Row.d30_base || 0);
    const d30Retained = Number(d30Row.d30_retained || 0);
    const d30Rate = d30Base > 0 ? Math.round((d30Retained / d30Base) * 10000) / 100 : 0;

    // ✅ 19/08: bloco da HOME do admin (/admin) — pendências do dia num lugar
    // só, pra página inicial nova não precisar de N queries do front.
    const { data: homeRows, error: homeErr } = await admin.rpc('exec_sql', {
      q: `
      select
        (select count(distinct session_id) from dora_conversations where needs_human = true and role = 'assistant') as dora_pendentes,
        (select count(*) from doramas where created_at > now() - interval '3 days' and (cover_url is null or length(title) > 120)) as catalogo_quebrado,
        (select count(*) from pix_payments p where p.status='paid' and p.created_at > now() - interval '24 hours' and p.user_id is not null
           and not exists (select 1 from subscriptions s where s.user_id = p.user_id and s.status in ('active','trialing','paid')
             and (coalesce(s.end_at, s.current_period_end) > now() or (coalesce(s.end_at, s.current_period_end) is null and s.provider is null)))) as pix_sem_acesso_24h
    ` });
    if (homeErr) console.error('[admin-analytics] home_query_failed:', homeErr);
    const homeRow = (homeRows && homeRows[0]) || {};

    // ✅ 01/08: "assinantes fiéis" — de quem está ativo AGORA, quantos já
    // renovaram pelo menos 1x (não é o primeiro ciclo, já provou que volta a
    // pagar). Independe do filtro de período (é sempre "agora"), mesma lógica
    // usada na conversa com o usuário pra estimar a base fiel (~1.184 batendo
    // perto do público da comunidade WhatsApp, ~1.040).
    const loyalQuery = `
      with ativos as (
        select s.user_id
        from subscriptions s
        where s.status in ('active','trialing','paid')
          and (
            (coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
            or coalesce(s.end_at, s.current_period_end) > now()
          )
      ),
      flagged as (
        select a.user_id,
          exists(select 1 from subscription_renewals sr where sr.user_id = a.user_id and sr.is_renewal = true) as renewed_once,
          (select count(*) from subscription_renewals sr where sr.user_id = a.user_id and sr.is_renewal = true) >= 2 as renewed_twice
        from ativos a
      )
      select
        count(*) as ativos_total,
        count(*) filter (where renewed_once) as fieis_1x,
        count(*) filter (where renewed_twice) as fieis_2x
      from flagged
    `;
    const { data: loyalRows, error: loyalErr } = await admin.rpc('exec_sql', { q: loyalQuery });
    if (loyalErr) console.error('[admin-analytics] loyal_query_failed:', loyalErr);
    const loyalRow = (loyalRows && loyalRows[0]) || {};
    const loyalOnce = Number(loyalRow.fieis_1x || 0);
    const loyalTwice = Number(loyalRow.fieis_2x || 0);
    const loyalTotal = Number(loyalRow.ativos_total || 0);

    // ✅ 01/08: composição da base ativa por número de renovações já feitas
    // (0 = 1º ciclo, 1, 2, 3...) — mostra o "funil de lealdade". SEM limite
    // fixo (nada de "4+") — agrupa pelo valor exato, então conforme os meses
    // passam e gente acumula mais renovações, novas faixas aparecem sozinhas.
    const tierQuery = `
      with ativos as (
        select s.user_id
        from subscriptions s
        where s.status in ('active','trialing','paid')
          and (
            (coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
            or coalesce(s.end_at, s.current_period_end) > now()
          )
      ),
      contagem as (
        select a.user_id,
          (select count(*) from subscription_renewals sr where sr.user_id = a.user_id and sr.is_renewal = true) as qtd_renovacoes
        from ativos a
      )
      select qtd_renovacoes as faixa, count(*) as qtd
      from contagem
      group by 1
      order by 1
    `;
    const { data: tierRowsRaw, error: tierErr } = await admin.rpc('exec_sql', { q: tierQuery });
    if (tierErr) console.error('[admin-analytics] tier_query_failed:', tierErr);
    const tierComposition = (tierRowsRaw || []).map((r: any) => ({
      faixa: Number(r.faixa || 0),
      qtd: Number(r.qtd || 0),
    }));

    // % de renovação de cada faixa — JANELA MÓVEL dos últimos 30 dias
    // (✅ 20/08, pedido do Stefano: era o último mês FECHADO e o número
    // ficava parado o mês inteiro, parecendo funil congelado; com a janela
    // móvel, cohort = quem estava coberto 30 dias atrás, retido = quem ainda
    // está coberto AGORA — atualiza a cada carregamento). Mesma lógica sem
    // limite fixo de faixa.
    const tierRetentionQuery = `
      with period as (
        select now() - interval '30 days' as p_start, now() as p_end
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
      tiered as (
        select ca.user_id,
          (select count(*) from subscription_renewals sr, period where sr.user_id = ca.user_id and sr.is_renewal = true and sr.renewed_at <= period.p_start) as faixa
        from cohort_a_active ca, period
      ),
      retained as (
        select t.user_id, t.faixa
        from tiered t
        join subscriptions s on s.user_id = t.user_id, period
        where s.status in ('active','trialing','paid')
          and ( (coalesce(s.end_at,s.current_period_end) is null and s.provider is null)
                or coalesce(s.end_at,s.current_period_end) > period.p_end )
      )
      select faixa, count(*) as cohort, (select count(*) from retained r where r.faixa = tiered.faixa) as retidos
      from tiered
      group by faixa
      order by faixa
    `;
    const { data: tierRetRowsRaw, error: tierRetErr } = await admin.rpc('exec_sql', { q: tierRetentionQuery });
    if (tierRetErr) console.error('[admin-analytics] tier_retention_query_failed:', tierRetErr);
    const tierRetention = (tierRetRowsRaw || []).map((r: any) => {
      const cohort = Number(r.cohort || 0);
      const retidos = Number(r.retidos || 0);
      return {
        faixa: Number(r.faixa || 0),
        cohort,
        retidos,
        taxa_pct: cohort > 0 ? Math.round((retidos / cohort) * 10000) / 100 : 0,
      };
    });

    // ✅ 05/08 (pedido do usuário): conversão avulso → assinante — de quem
    // comprou o dorama avulso de R$10 pelo bot do WhatsApp, quantos depois
    // criaram conta e assinaram de verdade. Métrica "lifetime" (não filtra
    // por período) porque a conversão pode acontecer meses depois da compra.
    // Limitação conhecida (documentada pro usuário): venda avulsa NUNCA
    // grava user_id (só entrega o link pro telefone e some — ver comentário
    // na CTE "avulso" acima), então só dá pra casar quem usa o MESMO
    // telefone no cadastro do site. Quem assina com telefone diferente do
    // que usou no bot fica invisível aqui — os números abaixo são um PISO,
    // não o total real de conversão.
    const avulsoConversionQuery = `
      with avulso as (
        select created_at, split_part(order_nsu, '|', 2) as raw_phone
        from pix_payments
        where status = 'paid' and provider in ('infinitepay','asaas') and plan = 'series'
      ),
      avulso_norm as (
        select
          created_at,
          raw_phone,
          case when left(raw_phone,2) = '55' and length(raw_phone) in (12,13)
            then substring(raw_phone from 3) else raw_phone end as phone_no55
        from avulso
      ),
      pessoas as (
        select phone_no55, raw_phone, min(created_at) as primeira_compra
        from avulso_norm
        group by 1, 2
      ),
      matched as (
        select pr.id as user_id, p.primeira_compra
        from pessoas p
        join profiles pr on pr.phone = p.phone_no55 or pr.phone = p.raw_phone
      ),
      first_sub_after as (
        select m.user_id, m.primeira_compra,
          (select min(sr.renewed_at) from subscription_renewals sr
             where sr.user_id = m.user_id and sr.renewed_at > m.primeira_compra) as assinou_em
        from matched m
      ),
      ativos_agora as (
        select distinct m.user_id
        from matched m
        join subscriptions s on s.user_id = m.user_id
        where s.status in ('active','trialing','paid')
          and ( (coalesce(s.end_at,s.current_period_end) is null and s.provider is null)
                or coalesce(s.end_at,s.current_period_end) > now() )
      )
      select
        (select count(distinct phone_no55) from pessoas) as pessoas_total,
        (select count(distinct user_id) from matched) as com_cadastro,
        (select count(distinct user_id) from matched m
           where exists (select 1 from subscriptions s where s.user_id = m.user_id)) as ja_assinaram,
        (select count(distinct user_id) from first_sub_after where assinou_em is not null) as assinaram_depois,
        (select count(*) from ativos_agora) as ativos_agora
    `;
    const { data: avConvRows, error: avConvErr } = await admin.rpc('exec_sql', { q: avulsoConversionQuery });
    if (avConvErr) console.error('[admin-analytics] avulso_conversion_query_failed:', avConvErr);
    const avConvRow = (avConvRows && avConvRows[0]) || {};
    const avulsoConversion = {
      pessoas_total: Number(avConvRow.pessoas_total || 0),
      com_cadastro: Number(avConvRow.com_cadastro || 0),
      ja_assinaram: Number(avConvRow.ja_assinaram || 0),
      assinaram_depois: Number(avConvRow.assinaram_depois || 0),
      ativos_agora: Number(avConvRow.ativos_agora || 0),
    };

    // ✅ 18/08 (pedido do Stefano): cadastros novos + conversão, com a MESMA
    // conta do relatório diário por e-mail (business-metrics-report →
    // computeCustomMetrics): cadastro = profiles.created_at no período;
    // "pagaram" = desses, quem tem QUALQUER linha em subscriptions (já pagou
    // alguma vez, mesmo que depois do período); conversão = pagaram/cadastros.
    // Além do período selecionado (e do de comparação), devolve sempre HOJE
    // e ESTE MÊS em horário de Brasília, pra bater com o e-mail sem depender
    // do filtro escolhido no painel.
    const signupsQuery = `
      with janelas as (
        select 'period' as k, '${periodStart}'::timestamptz as s, '${periodEnd}'::timestamptz as e
        union all select 'compare', '${comparePeriodStart}'::timestamptz, '${comparePeriodEnd}'::timestamptz
        union all select 'today', (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo', now()
        union all select 'this_month', (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo', now()
        union all select 'yesterday', (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '1 day') at time zone 'America/Sao_Paulo', (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo'
        union all select 'last_month', (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month') at time zone 'America/Sao_Paulo', (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo'
      )
      select j.k,
        count(p.id) as signups,
        count(p.id) filter (where exists (select 1 from subscriptions sub where sub.user_id = p.id)) as paid
      from janelas j
      left join profiles p on p.created_at >= j.s and p.created_at < j.e
      group by j.k
    `;
    const { data: signupRows, error: signupErr } = await admin.rpc('exec_sql', { q: signupsQuery });
    if (signupErr) console.error('[admin-analytics] signups_query_failed:', signupErr);
    const signupsByKey: Record<string, { signups: number; paid: number; conversion_rate: number }> = {};
    for (const r of signupRows || []) {
      const s = Number(r.signups || 0);
      const paid = Number(r.paid || 0);
      signupsByKey[String(r.k)] = {
        signups: s,
        paid,
        conversion_rate: s > 0 ? Math.round((paid / s) * 10000) / 100 : 0,
      };
    }
    const emptySignups = { signups: 0, paid: 0, conversion_rate: 0 };
    const signups = {
      period: signupsByKey.period || emptySignups,
      compare: signupsByKey.compare || emptySignups,
      today: signupsByKey.today || emptySignups,
      yesterday: signupsByKey.yesterday || emptySignups,
      this_month: signupsByKey.this_month || emptySignups,
      last_month: signupsByKey.last_month || emptySignups,
    };

    const churnACohort = Number(rev.churn_a_cohort || 0);
    const churnARetained = Number(rev.churn_a_retained || 0);
    const churnBCohort = Number(rev.churn_b_cohort || 0);
    const churnBRetained = Number(rev.churn_b_retained || 0);
    const churnAFrozen = Number(rev.churn_a_frozen_churned || 0);
    const churnAWinback = Number(rev.churn_a_winback || 0);
    const churnBFrozen = Number(rev.churn_b_frozen_churned || 0);
    const churnBWinback = Number(rev.churn_b_winback || 0);

    return json({
      sold_total: soldTotal,
      sold_monthly: soldMonthly,
      sold_quarterly: soldQuarterly,
      // ✅ 05/08: mesmo total de sold_monthly/sold_quarterly, só que
      // discriminado por canal — pedido depois de reclamação de que "hoje
      // tá bagunçado, não consigo saber o quanto vendeu no bot x no site".
      sold_by_channel: {
        bot: {
          total: botQtd,
          mensal: botMensal,
          trimestral: botTrimestral,
          revenue_estimated: botTotalReais,
        },
        site: {
          total: siteQtd,
          mensal: siteMensal,
          trimestral: siteTrimestral,
          revenue_estimated: siteTotalReais,
        },
      },
      revenue_period: pixTotal + stripeTotal + manualTotal,
      revenue_breakdown: {
        pix_infinitepay_asaas: pixTotal,
        stripe_estimated: stripeTotal,
        manual_estimated: manualTotal,
      },
      // ✅ 04/08: vendas avulsas de R$10 (dorama avulso via bot WhatsApp) —
      // de propósito FORA de revenue_period/revenue_breakdown, pra não
      // misturar com o faturamento de assinatura.
      avulso: {
        total: avulsoTotal,
        qtd_vendas: avulsoQtdVendas,
        qtd_pessoas: avulsoQtdPessoas,
      },
      // ✅ 05/08: quantos de quem comprou avulso viraram assinante depois
      // (ver limitação de matching por telefone no comentário acima).
      avulso_conversion: avulsoConversion,
      signups,
      home: {
        dora_pendentes: Number(homeRow.dora_pendentes || 0),
        catalogo_quebrado: Number(homeRow.catalogo_quebrado || 0),
        pix_sem_acesso_24h: Number(homeRow.pix_sem_acesso_24h || 0),
      },
      active_now: Number(rev.ativos_total || 0),
      active_now_monthly: Number(rev.ativos_mensal || 0),
      active_now_quarterly: Number(rev.ativos_trimestral || 0),
      // ✅ 19/08: MRR calculado AQUI (fonte única) com preço certo por grupo:
      // Stripe legado (provider null) paga 15,90/43,90; resto paga 17,90/49,90.
      mrr: (() => {
        const sm = Number(rev.ativos_stripe_mensal || 0);
        const st = Number(rev.ativos_stripe_trimestral || 0);
        const pm = Number(rev.ativos_mensal || 0) - sm;
        const pt = Number(rev.ativos_trimestral || 0) - st;
        const monthly = pm * PRICE_MONTHLY + sm * STRIPE_PRICE_MONTHLY;
        const quarterly = (pt * PRICE_QUARTERLY + st * STRIPE_PRICE_QUARTERLY) / 3;
        return {
          total: Math.round((monthly + quarterly) * 100) / 100,
          monthly: Math.round(monthly * 100) / 100,
          quarterly: Math.round(quarterly * 100) / 100,
          stripe_actives: sm + st,
        };
      })(),
      pending_now: pendingNow || 0,
      pending_in_period: pendingInPeriod || 0,
      d30_base: d30Base,
      d30_retained: d30Retained,
      d30_rate: d30Rate,
      loyal: {
        active_total: loyalTotal,
        renewed_once: loyalOnce,
        renewed_twice_plus: loyalTwice,
      },
      tier_composition: tierComposition,
      tier_retention_reference: tierRetention,
      churn: {
        period: {
          new: Number(rev.churn_a_new || 0),
          cohort: churnACohort,
          retained: churnARetained,
          churned: churnACohort - churnARetained,
          retention_rate: churnACohort > 0 ? Math.round((churnARetained / churnACohort) * 10000) / 100 : 0,
          winback: churnAWinback,
          winback_rate: churnAFrozen > 0 ? Math.round((churnAWinback / churnAFrozen) * 10000) / 100 : 0,
        },
        compare_period: {
          new: Number(rev.churn_b_new || 0),
          cohort: churnBCohort,
          retained: churnBRetained,
          churned: churnBCohort - churnBRetained,
          retention_rate: churnBCohort > 0 ? Math.round((churnBRetained / churnBCohort) * 10000) / 100 : 0,
          winback: churnBWinback,
          winback_rate: churnBFrozen > 0 ? Math.round((churnBWinback / churnBFrozen) * 10000) / 100 : 0,
          period_start: comparePeriodStart,
          period_end: comparePeriodEnd,
        },
      },
    });
  } catch (e) {
    return json({ error: 'internal', details: String(e) }, 500);
  }
});
