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
const PRICE_MONTHLY = 14.9;
const PRICE_QUARTERLY = 38.9;

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

// Utilitário pra montar range de datas
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
      if (!customStart || !customEnd) {
        return { start: null, end: null };
      }
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

// Datas
const getEndDate = (sub) =>
  new Date(sub.end_at || sub.current_period_end || sub.expires_at || sub.period_end || sub.end_at);

const getStartDate = (sub) =>
  new Date(
    sub.start_at || sub.current_period_start || sub.period_start || sub.created_at || sub.start_at
  );

const safeDate = (d) => {
  const nd = d instanceof Date ? d : new Date(d);
  if (!nd || Number.isNaN(nd.getTime())) return null;
  return nd;
};

const getPeriodDays = (sub) => {
  const s = safeDate(getStartDate(sub));
  const e = safeDate(getEndDate(sub));
  if (!s || !e) return 0;
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
    sub.plan_interval, // existe na sua tabela
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
  // 1) tenta pegar valor real do banco (se existir em alguma coluna)
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

  // 2) fallback: calcula por plano/duração
  const days = getPeriodDays(sub);

  if (isQuarterlyByText(sub)) return PRICE_QUARTERLY;
  if (isMonthlyByText(sub)) return PRICE_MONTHLY;

  if (days >= 80) return PRICE_QUARTERLY;
  return PRICE_MONTHLY;
};

// ✅ Ativo em T = start <= T  e  end > T
const isActiveAt = (sub, at) => {
  const s = safeDate(getStartDate(sub));
  const e = safeDate(getEndDate(sub));
  const a = safeDate(at);
  if (!s || !e || !a) return false;
  return s <= a && e > a;
};

// ✅ Interseção do intervalo da assinatura com o intervalo do filtro
const wasActiveInRange = (sub, rangeStart, rangeEnd) => {
  const s = safeDate(getStartDate(sub));
  const e = safeDate(getEndDate(sub));
  const rs = safeDate(rangeStart);
  const re = safeDate(rangeEnd);
  if (!s || !e || !rs || !re) return false;
  return s <= re && e > rs;
};

// Datas auxiliares
const startOfNextDay = (d) => {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + 1);
  nd.setHours(0, 0, 0, 0);
  return nd;
};

const endOfMonthFrom = (d) => {
  const nd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  nd.setHours(23, 59, 59, 999);
  return nd;
};

// ✅ distinct user_id (pessoas)
const distinctUserIds = (subs) => {
  const set = new Set();
  subs.forEach((s) => {
    if (s?.user_id) set.add(s.user_id);
  });
  return set;
};

// ✅ pega 1 assinatura “principal” por usuário (pra contar plano/MRR sem duplicar)
const pickPrimarySubPerUser = (subs) => {
  const map = new Map(); // user_id -> sub
  subs.forEach((s) => {
    const uid = s?.user_id;
    if (!uid) return;
    const curr = map.get(uid);
    const currEnd = curr ? safeDate(getEndDate(curr)) : null;
    const sEnd = safeDate(getEndDate(s));
    // escolhe a que tem maior end_at (mais “principal”/atual)
    if (!curr) map.set(uid, s);
    else if (sEnd && currEnd && sEnd > currEnd) map.set(uid, s);
    else if (sEnd && !currEnd) map.set(uid, s);
  });
  return Array.from(map.values());
};

// ✅ “renovou” sem last_renewed_at:
// usuário que VENCEU dentro do período e depois teve uma nova assinatura começando no mês seguinte
const hasRenewalInWindow = (userId, allSubs, windowStart, windowEnd) => {
  const ws = safeDate(windowStart);
  const we = safeDate(windowEnd);
  if (!userId || !ws || !we) return false;

  return allSubs.some((s) => {
    if (s.user_id !== userId) return false;
    const sd = safeDate(getStartDate(s));
    if (!sd) return false;
    return sd >= ws && sd <= we;
  });
};

const AdminAnalyticsPage = () => {
  // loading / erro
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ✅ FOTO (AGORA) — por pessoas (user_id)
  const [activeUsersNow, setActiveUsersNow] = useState(0);
  const [activeMonthlyUsersNow, setActiveMonthlyUsersNow] = useState(0);
  const [activeQuarterlyUsersNow, setActiveQuarterlyUsersNow] = useState(0);

  // ✅ NO PERÍODO (filtro)
  const [activeInPeriodUsers, setActiveInPeriodUsers] = useState(0);
  const [newUsersInPeriod, setNewUsersInPeriod] = useState(0); // profiles criados
  const [startedInPeriodUsers, setStartedInPeriodUsers] = useState(0); // assinaturas iniciadas
  const [expiredInPeriodUsers, setExpiredInPeriodUsers] = useState(0); // venceram (já vencidas até snapshot)

  // ✅ “MÊS BASE” obedecendo filtro (na prática: “venceram no período”)
  const [baseExpiredUsers, setBaseExpiredUsers] = useState(0);
  const [baseRenewedUsers, setBaseRenewedUsers] = useState(0);
  const [baseChurnedUsers, setBaseChurnedUsers] = useState(0);
  const [baseToExpireUsers, setBaseToExpireUsers] = useState(0); // se período ainda não acabou

  // ✅ receita / MRR
  const [mrr, setMrr] = useState(0);
  const [mrrMonthly, setMrrMonthly] = useState(0);
  const [mrrQuarterly, setMrrQuarterly] = useState(0);
  const [revenueInPeriod, setRevenueInPeriod] = useState(0);

  // ✅ pendências (ainda por assinatura, mas ok)
  const [pendingSubscriptions, setPendingSubscriptions] = useState(0);

  // ✅ churn % (base)
  const [churnRate, setChurnRate] = useState(0);

  // filtros
  const [filterType, setFilterType] = useState('month'); // ✅ default “este mês” pra fazer sentido
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [appliedRangeLabel, setAppliedRangeLabel] = useState('Exibindo todos os dados');

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

        const { start, end } = getDateRange(filterType, customStartDate, customEndDate);

        // ✅ Se o usuário escolheu “Tudo”, a gente força “mês atual” porque senão vira confuso
        // (mas você pode trocar se quiser)
        if (!start || !end) {
          const now0 = new Date();
          const s = new Date(now0.getFullYear(), now0.getMonth(), 1);
          const e = new Date(now0.getFullYear(), now0.getMonth() + 1, 0);
          s.setHours(0, 0, 0, 0);
          e.setHours(23, 59, 59, 999);
          // substitui “start/end” localmente
          // eslint-disable-next-line no-param-reassign
          // (não reatribui const, então fazemos variáveis abaixo)
        }

        const now = new Date();

        // período efetivo (sempre válido)
        let periodStart = start;
        let periodEnd = end;

        if (!periodStart || !periodEnd) {
          const s = new Date(now.getFullYear(), now.getMonth(), 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          s.setHours(0, 0, 0, 0);
          e.setHours(23, 59, 59, 999);
          periodStart = s;
          periodEnd = e;
        }

        // label amigável
        const fmt = (d) =>
          d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        setAppliedRangeLabel(`Período: ${fmt(periodStart)} até ${fmt(periodEnd)}`);

        // ✅ Snapshot: se período já acabou, usa final do período; senão usa NOW
        const snapshotAt = periodEnd < now ? periodEnd : now;

        // ✅ fim efetivo do período pra contar “ativas no período”
        const rangeEndEffective = periodEnd > now ? snapshotAt : periodEnd;

        // TOTAL USERS (profiles criados no período)
        const { count: usersCount, error: usersError } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', periodStart.toISOString())
          .lte('created_at', periodEnd.toISOString());

        if (usersError) throw usersError;
        setNewUsersInPeriod(usersCount || 0);

        // SUBSCRIPTIONS
        const { data: subsDataAll, error: subsError } = await supabase.from('subscriptions').select('*');
        if (subsError) throw subsError;
        const subsAll = subsDataAll || [];

        // =========================
        // 1) FOTO DO NEGÓCIO (AGORA)
        // =========================
        const activeSubsNowAll = subsAll.filter((s) => isActiveAt(s, snapshotAt));
        const activeUsersSet = distinctUserIds(activeSubsNowAll);
        setActiveUsersNow(activeUsersSet.size);

        // plano/MRR sem duplicar: pega 1 sub “principal” por usuário (somente entre as ativas)
        const primaryActiveSubsByUser = pickPrimarySubPerUser(activeSubsNowAll);

        let monthlyUsers = 0;
        let quarterlyUsers = 0;

        primaryActiveSubsByUser.forEach((sub) => {
          const days = getPeriodDays(sub);
          const isQuarter = isQuarterlyByText(sub) || days >= 80;
          if (isQuarter) quarterlyUsers += 1;
          else monthlyUsers += 1;
        });

        setActiveMonthlyUsersNow(monthlyUsers);
        setActiveQuarterlyUsersNow(quarterlyUsers);

        const mrrMonthlyValue = monthlyUsers * PRICE_MONTHLY;
        const mrrQuarterlyValue = quarterlyUsers * (PRICE_QUARTERLY / 3);

        setMrrMonthly(mrrMonthlyValue);
        setMrrQuarterly(mrrQuarterlyValue);
        setMrr(mrrMonthlyValue + mrrQuarterlyValue);

        // =========================
        // 2) EVENTOS DO PERÍODO (FILTRO)
        // =========================
        // Iniciadas no período (por pessoas)
        const startedInPeriod = subsAll.filter((sub) => {
          const sd = safeDate(getStartDate(sub));
          if (!sd) return false;
          return sd >= periodStart && sd <= periodEnd;
        });
        setStartedInPeriodUsers(distinctUserIds(startedInPeriod).size);

        // Ativas em algum momento do período (por pessoas)
        const activeInPeriod = subsAll.filter((sub) => wasActiveInRange(sub, periodStart, rangeEndEffective));
        setActiveInPeriodUsers(distinctUserIds(activeInPeriod).size);

        // Pendentes (por assinatura, ok)
        const pendingSubs = subsAll.filter((sub) =>
          ['pending', 'incomplete', 'requires_payment_method'].includes(sub.status)
        );
        setPendingSubscriptions(pendingSubs.length);

        // Venceram no período (já vencidas até snapshotAt) — por pessoas
        const expiredInPeriod = subsAll.filter((sub) => {
          const ed = safeDate(getEndDate(sub));
          if (!ed) return false;
          return ed >= periodStart && ed <= periodEnd && ed <= snapshotAt;
        });
        setExpiredInPeriodUsers(distinctUserIds(expiredInPeriod).size);

        // “Vão vencer no período” (se o período ainda não acabou) — por pessoas
        const willExpireInPeriod = subsAll.filter((sub) => {
          const ed = safeDate(getEndDate(sub));
          if (!ed) return false;
          return ed >= periodStart && ed <= periodEnd && ed > snapshotAt;
        });
        setBaseToExpireUsers(distinctUserIds(willExpireInPeriod).size);

        // Receita no período (aprox): soma do valor das assinaturas iniciadas no período (1 por usuário)
        const primaryStartedByUser = pickPrimarySubPerUser(startedInPeriod);
        const revenueApprox = primaryStartedByUser.reduce((acc, sub) => acc + (pickSubscriptionValue(sub) || 0), 0);
        setRevenueInPeriod(revenueApprox);

        // =========================
        // 3) “RENOVOU / FALTA RENOVAR / DESISTIU” (SEM last_renewed_at)
        // Base = quem VENCEU no período (já venceu até snapshotAt)
        // Renovou = tem nova assinatura iniciada no “mês seguinte” (janela)
        // Desistiu = base - renovou
        // =========================
        const baseExpiredUserIds = Array.from(distinctUserIds(expiredInPeriod));

        const nextStart = startOfNextDay(periodEnd); // 1º dia após o fim do período selecionado
        const nextEndFull = endOfMonthFrom(nextStart);
        const nextEndEffective = nextEndFull > snapshotAt ? snapshotAt : nextEndFull;

        let renewed = 0;
        baseExpiredUserIds.forEach((uid) => {
          if (hasRenewalInWindow(uid, subsAll, nextStart, nextEndEffective)) renewed += 1;
        });

        const baseTotal = baseExpiredUserIds.length;
        const churned = Math.max(baseTotal - renewed, 0);

        setBaseExpiredUsers(baseTotal);
        setBaseRenewedUsers(renewed);
        setBaseChurnedUsers(churned);

        setChurnRate(baseTotal > 0 ? (churned / baseTotal) * 100 : 0);

        // =========================
        // Usuários por status (amostra)
        // =========================
        let profilesListQuery = supabase
          .from('profiles')
          .select('id, email, created_at')
          .order('created_at', { ascending: false })
          .limit(200);

        profilesListQuery = profilesListQuery
          .gte('created_at', periodStart.toISOString())
          .lte('created_at', periodEnd.toISOString());

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
                  <h2 className="text-sm font-semibold text-slate-200">Filtro de período</h2>
                </div>
                <p className="text-xs text-slate-400">
                  Selecione um período para analisar suas métricas.{` `}
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
                    <option value="today">Hoje</option>
                    <option value="7days">Últimos 7 dias</option>
                    <option value="month">Este mês</option>
                    <option value="lastmonth">Mês passado</option>
                    <option value="year">Ano atual</option>
                    <option value="custom">Período personalizado</option>
                    <option value="all">Tudo (não recomendado)</option>
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
              {/* ✅ BLOCO 1 — FOTO DO NEGÓCIO (AGORA) */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Ativos agora (pessoas)
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{activeUsersNow}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Mensal: {activeMonthlyUsersNow} · Trimestral: {activeQuarterlyUsersNow}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ativas no período (pessoas):{' '}
                    <span className="font-semibold text-slate-200">{activeInPeriodUsers}</span>
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">MRR (total)</span>
                    <CreditCard className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(mrr)}</p>
                  <p className="mt-1 text-xs text-slate-500">Mensal + (Trimestral ÷ 3)</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Faturamento (período)
                    </span>
                    <CreditCard className="w-5 h-5 text-sky-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">
                    {formatCurrency(revenueInPeriod)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Aproximação: assinaturas iniciadas no período (1 por pessoa).
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">MRR Mensal</span>
                    <CreditCard className="w-5 h-5 text-purple-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(mrrMonthly)}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      MRR Trimestral (÷ 3)
                    </span>
                    <CreditCard className="w-5 h-5 text-amber-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(mrrQuarterly)}</p>
                </div>
              </section>

              {/* ✅ BLOCO 2 — EVENTOS DO PERÍODO */}
              <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Novos usuários (período)
                    </span>
                    <Users className="w-5 h-5 text-indigo-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{newUsersInPeriod}</p>
                  <p className="mt-1 text-xs text-slate-500">Profiles criados no período.</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Iniciaram assinatura (período)
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{startedInPeriodUsers}</p>
                  <p className="mt-1 text-xs text-slate-500">Pessoas com start_at no período.</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Venceram (período)
                    </span>
                    <AlertCircle className="w-5 h-5 text-rose-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{expiredInPeriodUsers}</p>
                  <p className="mt-1 text-xs text-slate-500">Pessoas com end_at no período (já vencidas).</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Assinaturas pendentes
                    </span>
                    <Clock className="w-5 h-5 text-amber-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{pendingSubscriptions}</p>
                  <p className="mt-1 text-xs text-slate-500">Por assinatura (status pending/incomplete).</p>
                </div>
              </section>

              {/* ✅ BLOCO 3 — RENOVAÇÃO / DESISTÊNCIA (o que você quer) */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Base (venceram no período)
                    </span>
                    <Users className="w-5 h-5 text-indigo-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{baseExpiredUsers}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Pessoas que venceram dentro do período selecionado.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Renovaram (mês seguinte)
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{baseRenewedUsers}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Detectado sem last_renewed_at: nova assinatura iniciada no mês seguinte.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Desistiram</span>
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{baseChurnedUsers}</p>
                  <p className="mt-1 text-xs text-slate-500">Base − Renovaram.</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Churn (base)</span>
                    <AlertCircle className="w-5 h-5 text-rose-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{formatPercent(churnRate)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Desistiram / Base (no período selecionado).
                  </p>
                </div>
              </section>

              {/* ✅ Se o período ainda não acabou, mostra “vão vencer” */}
              <section className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-300" />
                    <h2 className="text-sm font-semibold text-slate-200">Restante do período</h2>
                  </div>
                  <span className="text-xs text-slate-400">somente se o período estiver em andamento</span>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Vão vencer (ainda)</p>
                    <p className="mt-1 text-2xl font-bold text-slate-50">{baseToExpireUsers}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Pessoas com end_at no período, mas que ainda não venceu até agora.
                    </p>
                  </div>

                  <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Ticket médio (MRR / ativo)</p>
                    <p className="mt-1 text-2xl font-bold text-slate-50">
                      {activeUsersNow > 0 ? formatCurrency(mrr / activeUsersNow) : formatCurrency(0)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Aproximação por pessoa ativa agora.</p>
                  </div>

                  <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Ativas no período (pessoas)</p>
                    <p className="mt-1 text-2xl font-bold text-slate-50">{activeInPeriodUsers}</p>
                    <p className="mt-1 text-xs text-slate-500">Esteve ativa em algum momento do período.</p>
                  </div>
                </div>
              </section>

              {/* Tabela usuários por status */}
              <section className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-indigo-300" />
                  <h2 className="text-sm font-semibold text-slate-200">Usuários por status (amostra)</h2>
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
            </>
          )}
        </main>
      </div>
    </>
  );
};

export default AdminAnalyticsPage;
