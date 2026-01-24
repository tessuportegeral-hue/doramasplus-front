// src/pages/AdminAnalytics.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { supabase } from '@/lib/supabaseClient';
import {
  BarChart3,
  Users,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Calendar,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * ✅ AJUSTE OS PREÇOS AQUI (em reais)
 * - Mensal: DoramaPlay Padrão
 * - Trimestral: DoramaPlay Trimestral
 */
const PRICE_MONTHLY = 14.90;
const PRICE_QUARTERLY = 38.90;

// Abas do painel admin (Analytics | Doramas | Usuários)
const AdminTopNav = ({ current }) => {
  const navigate = useNavigate();

  const items = [
    { id: 'analytics', label: 'Analytics', path: '/admin/analytics' },
    { id: 'doramas', label: 'Doramas', path: '/admin/doramas' },
    { id: 'users', label: 'Usuários', path: '/admin/users' },
  ];

  return (
    <nav className="mb-6 border-b border-slate-800">
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isActive = current === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className={
                'px-3 py-1.5 text-sm rounded-md border transition-colors ' +
                (isActive
                  ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800')
              }
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

// Utilitário pra montar range de datas (filtro)
const getDateRange = (filterType, customStart, customEnd) => {
  const now = new Date();

  const startOfDay = (d) => {
    const nd = new Date(d);
    nd.setHours(0, 0, 0, 0);
    return nd;
  };

  const endOfDay = (d) => {
    const nd = new Date(d);
    nd.setHours(23, 59, 59, 999);
    return nd;
  };

  let start = null;
  let end = null;

  switch (filterType) {
    case 'today': {
      start = startOfDay(now);
      end = endOfDay(now);
      break;
    }
    case '7days': {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      start = startOfDay(s);
      end = endOfDay(now);
      break;
    }
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      start = startOfDay(s);
      end = endOfDay(e);
      break;
    }
    case 'lastmonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      start = startOfDay(s);
      end = endOfDay(e);
      break;
    }
    case 'year': {
      const s = new Date(now.getFullYear(), 0, 1);
      const e = new Date(now.getFullYear(), 11, 31);
      start = startOfDay(s);
      end = endOfDay(e);
      break;
    }
    case 'custom': {
      if (!customStart || !customEnd) return { start: null, end: null };
      const s = startOfDay(customStart);
      const e = endOfDay(customEnd);
      start = s;
      end = e;
      break;
    }
    case 'all':
    default:
      start = null;
      end = null;
  }

  return { start, end };
};

// Helpers
const toLower = (v) => String(v || '').toLowerCase().trim();

const parseMoneySmart = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // 1590, 3990 etc => centavos
  return n >= 100 ? n / 100 : n;
};

// Datas base (prioriza start_at/end_at)
const getEndDate = (sub) =>
  new Date(
    sub.end_at ||
      sub.current_period_end ||
      sub.expires_at ||
      sub.period_end ||
      sub.end_at
  );

const getStartDate = (sub) =>
  new Date(
    sub.start_at ||
      sub.current_period_start ||
      sub.period_start ||
      sub.created_at ||
      sub.start_at
  );

const getPeriodDays = (sub) => {
  const s = getStartDate(sub);
  const e = getEndDate(sub);
  const diff = e.getTime() - s.getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

const isQuarterlyByText = (sub) => {
  const blob = [
    sub.plan_name,
    sub.plan,
    sub.plan_type,
    sub.product_name,
    sub.price_name,
    sub.subscription_type,
    sub.interval,
    sub.plan_interval,
    sub.type,
  ]
    .map(toLower)
    .join(' ');

  return (
    blob.includes('trimes') ||
    blob.includes('quarter') ||
    blob.includes('3 meses') ||
    blob.includes('3mes') ||
    blob.includes('90') ||
    blob.includes('trimestral')
  );
};

const isMonthlyByText = (sub) => {
  const blob = [
    sub.plan_name,
    sub.plan,
    sub.plan_type,
    sub.product_name,
    sub.price_name,
    sub.subscription_type,
    sub.interval,
    sub.plan_interval,
    sub.type,
  ]
    .map(toLower)
    .join(' ');

  return blob.includes('mensal') || blob.includes('month') || blob.includes('30');
};

const pickSubscriptionValue = (sub) => {
  const candidates = [
    sub.amount_monthly,
    sub.amount,
    sub.price,
    sub.price_amount,
    sub.plan_amount,
    sub.value,
    sub.total,
    sub.unit_amount,
    sub.unit_amount_decimal,
  ];

  for (const c of candidates) {
    const v = parseMoneySmart(c);
    if (v > 0) return v;
  }

  const days = getPeriodDays(sub);

  if (isQuarterlyByText(sub)) return PRICE_QUARTERLY;
  if (isMonthlyByText(sub)) return PRICE_MONTHLY;

  if (days >= 80) return PRICE_QUARTERLY;
  return PRICE_MONTHLY;
};

// Ativo em T = start <= T e end > T
const isActiveAt = (sub, at) => {
  const s = getStartDate(sub);
  const e = getEndDate(sub);
  if (!at || !s || !e) return false;
  if (
    Number.isNaN(s.getTime()) ||
    Number.isNaN(e.getTime()) ||
    Number.isNaN(at.getTime())
  ) {
    return false;
  }
  return s <= at && e > at;
};

const AdminAnalyticsPage = () => {
  // loading / erro
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // FOTO DO NEGÓCIO (agora)
  const [activeNow, setActiveNow] = useState(0);
  const [activeMonthlyNow, setActiveMonthlyNow] = useState(0);
  const [activeQuarterlyNow, setActiveQuarterlyNow] = useState(0);
  const [pendingNow, setPendingNow] = useState(0);
  const [mrr, setMrr] = useState(0);
  const [mrrMonthly, setMrrMonthly] = useState(0);
  const [mrrQuarterly, setMrrQuarterly] = useState(0);

  // MÊS/PERÍODO SELECIONADO (obedece filtro)
  const [dueInPeriod, setDueInPeriod] = useState(0);          // vencem no período
  const [dueFuture, setDueFuture] = useState(0);              // ainda vão vencer
  const [duePast, setDuePast] = useState(0);                  // já venceram
  const [churnedInPeriod, setChurnedInPeriod] = useState(0);  // desistiram (definitivo)
  const [renewedEstimated, setRenewedEstimated] = useState(0);// renovaram (estimado)
  const [soldMonthlyInPeriod, setSoldMonthlyInPeriod] = useState(0);
  const [soldQuarterlyInPeriod, setSoldQuarterlyInPeriod] = useState(0);

  // Outras infos
  const [totalUsers, setTotalUsers] = useState(0);
  const [appliedRangeLabel, setAppliedRangeLabel] = useState('Exibindo período');

  // filtros
  const [filterType, setFilterType] = useState('month'); // ✅ default: este mês (faz sentido pro seu uso)
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // usuários por status (amostra)
  const [usersByStatus, setUsersByStatus] = useState({
    active: [],
    pending: [],
    inactive: [],
  });

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        setError(null);

        const now = new Date();
        const { start, end } = getDateRange(filterType, customStartDate, customEndDate);

        // ✅ Se não tiver start/end (caso "all"), usa mês atual pro bloco de continuidade
        const periodStart = start
          ? new Date(start)
          : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

        const periodEnd = end
          ? new Date(end)
          : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // snapshotAt: se o período já acabou, usa fim do período; senão usa now
        const snapshotAt = periodEnd < now ? periodEnd : now;

        const fmt = (d) =>
          d.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });

        setAppliedRangeLabel(`Período: ${fmt(periodStart)} até ${fmt(periodEnd)}`);

        // TOTAL USERS (mantém por período real quando existe)
        let profilesCountQuery = supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true });

        if (start && end) {
          profilesCountQuery = profilesCountQuery
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString());
        }

        const { count: usersCount, error: usersError } = await profilesCountQuery;
        if (usersError) throw usersError;
        setTotalUsers(usersCount || 0);

        // SUBSCRIPTIONS
        const { data: subsDataAll, error: subsError } = await supabase
          .from('subscriptions')
          .select('*');

        if (subsError) throw subsError;

        const subsAll = subsDataAll || [];

        // =========================
        // ✅ BLOCO A — FOTO DO NEGÓCIO (AGORA)
        // =========================
        const activeSubsNow = subsAll.filter((sub) => isActiveAt(sub, now));
        setActiveNow(activeSubsNow.length);

        const pendingSubsNow = subsAll.filter((sub) =>
          ['pending', 'incomplete', 'requires_payment_method'].includes(sub.status)
        );
        setPendingNow(pendingSubsNow.length);

        let monthlyCountNow = 0;
        let quarterlyCountNow = 0;

        activeSubsNow.forEach((sub) => {
          const days = getPeriodDays(sub);
          const isQuarter = isQuarterlyByText(sub) || days >= 80;
          if (isQuarter) quarterlyCountNow += 1;
          else monthlyCountNow += 1;
        });

        setActiveMonthlyNow(monthlyCountNow);
        setActiveQuarterlyNow(quarterlyCountNow);

        const mrrMonthlyValue = monthlyCountNow * PRICE_MONTHLY;
        const mrrQuarterlyValue = quarterlyCountNow * (PRICE_QUARTERLY / 3);

        setMrrMonthly(mrrMonthlyValue);
        setMrrQuarterly(mrrQuarterlyValue);
        setMrr(mrrMonthlyValue + mrrQuarterlyValue);

        // =========================
        // ✅ BLOCO B — MÊS/PERÍODO SELECIONADO (RENOVAÇÃO SEM last_renewed_at)
        // =========================

        // 1) Vencem no período = end_at dentro do período
        const dueSubs = subsAll.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;
          return ed >= periodStart && ed <= periodEnd;
        });

        const dueTotal = dueSubs.length;
        setDueInPeriod(dueTotal);

        // 2) Ainda vão vencer (dentro do período) = end_at > snapshotAt
        const dueNotYet = dueSubs.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;
          return ed > snapshotAt;
        }).length;
        setDueFuture(dueNotYet);

        // 3) Já venceram (dentro do período) = end_at <= snapshotAt
        const dueAlready = dueSubs.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;
          return ed <= snapshotAt;
        });
        setDuePast(dueAlready.length);

        // 4) Desistiram (churn do período) =
        //    venceu no período ATÉ snapshotAt e o user NÃO tem nenhuma assinatura ativa em snapshotAt
        const isUserActiveAtSnapshot = (userId) => {
          if (!userId) return false;
          return subsAll.some((s) => s.user_id === userId && isActiveAt(s, snapshotAt));
        };

        const churned = dueAlready.filter((sub) => {
          const uid = sub.user_id;
          // se não tem user_id, não dá pra confirmar churn, então não conta como churn
          if (!uid) return false;
          return !isUserActiveAtSnapshot(uid);
        }).length;
        setChurnedInPeriod(churned);

        // 5) Renovaram (estimado) = já venceram - desistiram
        const renewedByDiff = Math.max(0, dueAlready.length - churned);
        setRenewedEstimated(renewedByDiff);

        // 6) Vendas no período (start_at no período)
        const startedInPeriod = subsAll.filter((sub) => {
          const sd = getStartDate(sub);
          if (!sd || Number.isNaN(sd.getTime())) return false;
          return sd >= periodStart && sd <= periodEnd;
        });

        const soldQuarter = startedInPeriod.filter((sub) => {
          const days = getPeriodDays(sub);
          const isQuarter = isQuarterlyByText(sub) || days >= 80;
          return isQuarter;
        }).length;

        const soldMonth = startedInPeriod.filter((sub) => {
          const days = getPeriodDays(sub);
          const isQuarter = isQuarterlyByText(sub) || days >= 80;
          return !isQuarter;
        }).length;

        setSoldQuarterlyInPeriod(soldQuarter);
        setSoldMonthlyInPeriod(soldMonth);

        // =========================
        // ✅ Usuários por status (amostra) — baseado na foto do snapshotAt (pra ficar consistente)
        // =========================
        let profilesListQuery = supabase
          .from('profiles')
          .select('id, email, created_at')
          .order('created_at', { ascending: false })
          .limit(200);

        if (start && end) {
          profilesListQuery = profilesListQuery
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString());
        }

        const { data: profilesList, error: profilesListError } = await profilesListQuery;
        if (profilesListError) throw profilesListError;

        const activeUsers = [];
        const pendingUsers = [];
        const inactiveUsers = [];

        (profilesList || []).forEach((profile) => {
          const userSubs = subsAll.filter((s) => s.user_id === profile.id);

          let status = 'inactive';

          const hasActive = userSubs.some((s) => isActiveAt(s, snapshotAt));
          const hasPending = userSubs.some((s) =>
            ['pending', 'incomplete', 'requires_payment_method'].includes(s.status)
          );

          if (hasActive) status = 'active';
          else if (hasPending) status = 'pending';

          const userData = {
            id: profile.id,
            email: profile.email,
            created_at: profile.created_at,
            status,
          };

          if (status === 'active') activeUsers.push(userData);
          else if (status === 'pending') pendingUsers.push(userData);
          else inactiveUsers.push(userData);
        });

        setUsersByStatus({
          active: activeUsers,
          pending: pendingUsers,
          inactive: inactiveUsers,
        });
      } catch (err) {
        console.error('Erro ao carregar analytics:', err);
        setError(err.message || 'Erro ao carregar analytics');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [filterType, customStartDate, customEndDate]);

  const formatCurrency = (value) => {
    return Number(value || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    });
  };

  const formatPercent = (value) => {
    return (
      Number(value || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + '%'
    );
  };

  // Taxas úteis
  const renewalRate =
    duePast > 0 ? (renewedEstimated / duePast) * 100 : 0;

  const churnRatePeriod =
    duePast > 0 ? (churnedInPeriod / duePast) * 100 : 0;

  const combinedUsers = useMemo(() => {
    return [
      ...usersByStatus.active.map((u) => ({
        ...u,
        statusLabel: 'Ativo',
        statusColor: 'text-emerald-400',
      })),
      ...usersByStatus.pending.map((u) => ({
        ...u,
        statusLabel: 'Pendente',
        statusColor: 'text-amber-300',
      })),
      ...usersByStatus.inactive.map((u) => ({
        ...u,
        statusLabel: 'Inativo',
        statusColor: 'text-slate-400',
      })),
    ]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);
  }, [usersByStatus]);

  return (
    <>
      <Helmet>
        <title>Painel Administrativo – DoramasPlus</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8">
        {/* Cabeçalho */}
        <header className="mb-4 max-w-7xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-purple-400 flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-purple-300" />
            Painel Administrativo
          </h1>
          <p className="text-slate-400 text-sm sm:text-base mt-1">
            Métricas em tempo real da sua base de assinantes DoramasPlus.
          </p>
        </header>

        {/* Abas do admin */}
        <div className="max-w-7xl mx-auto">
          <AdminTopNav current="analytics" />
        </div>

        <main className="max-w-7xl mx-auto space-y-8">
          {/* Filtro de período */}
          <section className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
            <div className="flex flex-col lg:flex-row gap-4 lg:items-end lg:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-purple-300" />
                  <h2 className="text-sm font-semibold text-slate-200">
                    Filtro de período
                  </h2>
                </div>
                <p className="text-xs text-slate-400">
                  Selecione um período para analisar o mês/período.{` `}
                  <span className="text-slate-300">{appliedRangeLabel}</span>
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Período rápido</label>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="month">Este mês</option>
                    <option value="lastmonth">Mês passado</option>
                    <option value="7days">Últimos 7 dias</option>
                    <option value="today">Hoje</option>
                    <option value="year">Ano atual</option>
                    <option value="custom">Período personalizado</option>
                    <option value="all">Tudo (usa mês atual pra continuidade)</option>
                  </select>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Data inicial</label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100"
                      disabled={filterType !== 'custom'}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Data final</label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100"
                      disabled={filterType !== 'custom'}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400 mb-3" />
              <p className="text-slate-400">Carregando métricas...</p>
            </div>
          )}

          {!loading && error && (
            <div className="bg-red-900/20 border border-red-500/40 text-red-100 p-4 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 mt-0.5" />
              <div>
                <p className="font-semibold">Erro ao carregar analytics</p>
                <p className="text-sm text-red-200">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* ✅ BLOCO A — FOTO DO NEGÓCIO (AGORA) */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-slate-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-sm font-semibold">Foto do negócio (agora)</h2>
                </div>

                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Ativos agora
                      </span>
                      <Users className="w-5 h-5 text-emerald-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{activeNow}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Mensal: {activeMonthlyNow} · Trimestral: {activeQuarterlyNow}
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Pendentes agora
                      </span>
                      <Clock className="w-5 h-5 text-amber-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{pendingNow}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Podem virar receita
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        MRR total
                      </span>
                      <CreditCard className="w-5 h-5 text-emerald-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(mrr)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Mensal + (Trimestral ÷ 3)
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        MRR Mensal
                      </span>
                      <CreditCard className="w-5 h-5 text-purple-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(mrrMonthly)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {activeMonthlyNow} assinaturas
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        MRR Trimestral
                      </span>
                      <CreditCard className="w-5 h-5 text-amber-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(mrrQuarterly)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {activeQuarterlyNow} assinaturas (÷3)
                    </p>
                  </div>
                </section>
              </section>

              {/* ✅ BLOCO B — MÊS/PERÍODO SELECIONADO */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-slate-200">
                  <Calendar className="w-5 h-5 text-purple-300" />
                  <h2 className="text-sm font-semibold">Mês/Período selecionado (renovação)</h2>
                </div>

                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Vencem no período
                      </span>
                      <Clock className="w-5 h-5 text-sky-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{dueInPeriod}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      “Boletos” do período
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Ainda vão vencer
                      </span>
                      <Clock className="w-5 h-5 text-amber-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{dueFuture}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      End_at &gt; hoje
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Já venceram
                      </span>
                      <AlertCircle className="w-5 h-5 text-slate-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{duePast}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      End_at ≤ hoje
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Desistiram
                      </span>
                      <AlertCircle className="w-5 h-5 text-red-400" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{churnedInPeriod}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      %: <span className="font-semibold text-slate-200">{formatPercent(churnRatePeriod)}</span>
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Renovaram (estimado)
                      </span>
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{renewedEstimated}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      %: <span className="font-semibold text-slate-200">{formatPercent(renewalRate)}</span>
                    </p>
                  </div>

                  <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        Trimestral vendido
                      </span>
                      <CreditCard className="w-5 h-5 text-amber-300" />
                    </div>
                    <p className="mt-3 text-3xl font-bold text-slate-50">{soldQuarterlyInPeriod}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Mensal vendido: <span className="font-semibold text-slate-200">{soldMonthlyInPeriod}</span>
                    </p>
                  </div>
                </section>
              </section>

              {/* Usuários por status (amostra) */}
              <section className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-indigo-300" />
                  <h2 className="text-sm font-semibold text-slate-200">
                    Usuários por status (amostra)
                  </h2>
                </div>

                {combinedUsers.length === 0 ? (
                  <p className="text-xs sm:text-sm text-slate-400">
                    Nenhum usuário encontrado para o período selecionado.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="text-left border-b border-slate-800 text-slate-400">
                          <th className="py-2 pr-4">Email</th>
                          <th className="py-2 pr-4">Criado em</th>
                          <th className="py-2 pr-4">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedUsers.map((u) => (
                          <tr key={u.id} className="border-b border-slate-900 last:border-0">
                            <td className="py-2 pr-4 text-slate-100 break-all">{u.email || '—'}</td>
                            <td className="py-2 pr-4 text-slate-300">
                              {u.created_at
                                ? new Date(u.created_at).toLocaleString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                  })
                                : '—'}
                            </td>
                            <td className="py-2 pr-4">
                              <span className={`text-xs font-semibold ${u.statusColor}`}>
                                {u.statusLabel}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Rodapé leve (opcional) */}
              <section className="text-xs text-slate-500">
                <p>
                  Nota: “Renovaram (estimado)” é calculado sem last_renewed_at:
                  <span className="text-slate-300"> já venceram − desistiram</span>.
                  Se você preencher um evento de renovação no backend, dá pra trocar por “renovação real”.
                </p>
              </section>
            </>
          )}
        </main>
      </div>
    </>
  );
};

export default AdminAnalyticsPage;
