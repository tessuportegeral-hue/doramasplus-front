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
const PRICE_QUARTERLY = 38.90; // <-- se o seu trimestral for outro valor, troca aqui

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

// ✅ prioriza os campos que EXISTEM na sua tabela (start_at / end_at)
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

// (continua existindo, mas hoje não dá pra confiar se não preenche)
const getRenewedAt = (sub) => {
  if (!sub.last_renewed_at) return null;
  const d = new Date(sub.last_renewed_at);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
};

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
    sub.plan_interval,
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
    sub.plan_interval,
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

  // 2) fallback: calcula por plano/duração (FRONT)
  const days = getPeriodDays(sub);

  if (isQuarterlyByText(sub)) return PRICE_QUARTERLY;
  if (isMonthlyByText(sub)) return PRICE_MONTHLY;

  if (days >= 80) return PRICE_QUARTERLY;
  return PRICE_MONTHLY;
};

// ✅ regra consistente: Ativo em T = start <= T  e  end > T
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

// ✅ esteve ativo em ALGUM MOMENTO dentro do período [rangeStart, rangeEnd]
const wasActiveInRange = (sub, rangeStart, rangeEnd) => {
  const s = getStartDate(sub);
  const e = getEndDate(sub);
  if (!rangeStart || !rangeEnd || !s || !e) return false;
  if (
    Number.isNaN(s.getTime()) ||
    Number.isNaN(e.getTime()) ||
    Number.isNaN(rangeStart.getTime()) ||
    Number.isNaN(rangeEnd.getTime())
  ) {
    return false;
  }
  // intersecta se start <= rangeEnd e end > rangeStart
  return s <= rangeEnd && e > rangeStart;
};

const AdminAnalyticsPage = () => {
  // loading / erro
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // métricas
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalSubscriptions, setTotalSubscriptions] = useState(0);
  const [activeSubscriptions, setActiveSubscriptions] = useState(0);
  const [pendingSubscriptions, setPendingSubscriptions] = useState(0);
  const [expiredSubscriptions, setExpiredSubscriptions] = useState(0);

  // ativas no período (em algum momento)
  const [activeInPeriodCount, setActiveInPeriodCount] = useState(0);

  // ✅ FUNIL DE VENCIMENTO (obedece filtro)
  const [expiringInPeriodTotal, setExpiringInPeriodTotal] = useState(0); // vencem no mês/período
  const [expiringToRenew, setExpiringToRenew] = useState(0); // ainda vão vencer (end_at > snapshotAt)
  const [expiringChurned, setExpiringChurned] = useState(0); // já venceram (end_at <= snapshotAt)
  const [expiringRenewedDeduction, setExpiringRenewedDeduction] = useState(0); // dedução

  // ✅ CARD “ATIVOS DO MÊS ANTERIOR QUE VENCEM NO MÊS ATUAL”
  const [prevMonthActiveThatExpireThisPeriod, setPrevMonthActiveThatExpireThisPeriod] = useState(0);
  const [prevMonthQuarterlyStarted, setPrevMonthQuarterlyStarted] = useState(0);

  // receita
  const [mrr, setMrr] = useState(0);
  const [mrrMonthly, setMrrMonthly] = useState(0);
  const [mrrQuarterly, setMrrQuarterly] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);

  // contagens por plano (ativo)
  const [activeMonthlyCount, setActiveMonthlyCount] = useState(0);
  const [activeQuarterlyCount, setActiveQuarterlyCount] = useState(0);

  const [conversionRate, setConversionRate] = useState(0);
  const [retentionRate, setRetentionRate] = useState(0);

  // churn no período (vencidos dentro do período até agora)
  const [churnRate, setChurnRate] = useState(0);
  const [churnCount, setChurnCount] = useState(0);

  // renovações no período (last_renewed_at) — hoje pode ficar 0 se não preenche
  const [renewedCount, setRenewedCount] = useState(0);

  // filtros
  const [filterType, setFilterType] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const [appliedRangeLabel, setAppliedRangeLabel] = useState('Exibindo todos os dados');

  // usuários por status
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

        const now = new Date();

        // ✅ se não tiver filtro, para o “funil do mês” fazer sentido, usa o MÊS ATUAL
        const effectiveStart = start
          ? new Date(start)
          : new Date(now.getFullYear(), now.getMonth(), 1);
        const effectiveEnd = end
          ? new Date(end)
          : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // Label amigável do período
        const fmt = (d) =>
          d.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });

        if (!start || !end) {
          setAppliedRangeLabel(`Período: ${fmt(effectiveStart)} até ${fmt(effectiveEnd)} (mês atual)`);
        } else {
          setAppliedRangeLabel(`Período: ${fmt(start)} até ${fmt(end)}`);
        }

        // ✅ SnapshotAt: se o período já acabou, usa o final do período; senão usa NOW
        const snapshotAt = effectiveEnd < now ? effectiveEnd : now;

        // TOTAL USERS
        let profilesCountQuery = supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true });

        // (mantém: se tiver filtro real, aplica; se não tiver, mantém geral)
        if (start && end) {
          profilesCountQuery = profilesCountQuery
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString());
        }

        const { count: usersCount, error: usersError } = await profilesCountQuery;
        if (usersError) throw usersError;
        setTotalUsers(usersCount || 0);

        // SUBSCRIPTIONS (busca tudo e filtra no FRONT)
        const { data: subsDataAll, error: subsError } = await supabase
          .from('subscriptions')
          .select('*');

        if (subsError) throw subsError;

        const subsAll = subsDataAll || [];

        // totalSubscriptions (mantém: por start dentro do filtro REAL; se não tiver, mostra tudo)
        const isInRangeByStart = (sub) => {
          if (!start || !end) return true;
          const sd = getStartDate(sub);
          if (!sd || Number.isNaN(sd.getTime())) return false;
          return sd >= start && sd <= end;
        };

        const subsForTotalByStart = subsAll.filter(isInRangeByStart);
        setTotalSubscriptions(subsForTotalByStart.length);

        // ✅ ATIVOS (foto)
        const activeSubsSnapshot = subsAll.filter((sub) => isActiveAt(sub, snapshotAt));
        setActiveSubscriptions(activeSubsSnapshot.length);

        // ✅ ATIVAS NO PERÍODO (em algum momento)
        const rangeEndEffective = effectiveEnd > now ? snapshotAt : effectiveEnd;
        const activeSomeTimeInRange = subsAll.filter((sub) =>
          wasActiveInRange(sub, effectiveStart, rangeEndEffective)
        ).length;
        setActiveInPeriodCount(activeSomeTimeInRange);

        // Pendentes (mantém comportamento: pendentes do recorte por start do período real)
        const pendingSubs = subsForTotalByStart.filter((sub) =>
          ['pending', 'incomplete', 'requires_payment_method'].includes(sub.status)
        );
        setPendingSubscriptions(pendingSubs.length);

        // ✅ Expiradas (geral): se tiver filtro real, expiradas dentro do filtro até snapshot; senão expiradas até hoje
        const expiredSubs = start && end
          ? subsAll.filter((sub) => {
              const ed = getEndDate(sub);
              if (!ed || Number.isNaN(ed.getTime())) return false;
              return ed >= start && ed <= end && ed <= snapshotAt;
            })
          : subsAll.filter((sub) => {
              const ed = getEndDate(sub);
              if (!ed || Number.isNaN(ed.getTime())) return false;
              return ed <= snapshotAt;
            });

        setExpiredSubscriptions(expiredSubs.length);

        /**
         * ✅ FUNIL DE VENCIMENTO (OBEDECE O PERÍODO EFETIVO)
         * Vencem no período: end_at dentro do período
         * - “desistiram”: end_at <= snapshotAt
         * - “ainda pra renovar”: end_at > snapshotAt
         * - “renovaram (dedução)”: vencem_total - desistiram - ainda_pra_renovar
         */
        const expiringInPeriod = subsAll.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;
          return ed >= effectiveStart && ed <= effectiveEnd;
        });

        const expiringTotal = expiringInPeriod.length;

        const churnedInPeriod = expiringInPeriod.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;
          return ed <= snapshotAt;
        }).length;

        const toRenewInPeriod = expiringInPeriod.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;
          return ed > snapshotAt;
        }).length;

        const renewedDeduction = Math.max(0, expiringTotal - churnedInPeriod - toRenewInPeriod);

        setExpiringInPeriodTotal(expiringTotal);
        setExpiringChurned(churnedInPeriod);
        setExpiringToRenew(toRenewInPeriod);
        setExpiringRenewedDeduction(renewedDeduction);

        // ✅ CHURN (período) = churnedInPeriod / (ativos + churnedInPeriod) (base aproximada)
        if (effectiveStart && effectiveEnd) {
          const base = activeSubsSnapshot.length + churnedInPeriod;
          setChurnCount(churnedInPeriod);
          setChurnRate(base > 0 ? (churnedInPeriod / base) * 100 : 0);
        } else {
          setChurnRate(0);
          setChurnCount(0);
        }

        /**
         * ✅ CARD: “TOTAL DE ATIVOS DO MÊS ANTERIOR QUE VENCEM NO MÊS ATUAL”
         * Regra:
         * - pega o último dia do mês anterior ao início do período (effectiveStart)
         * - conta quem estava ATIVO naquela data
         * - e cujo end_at cai dentro do período atual (effectiveStart..effectiveEnd)
         */
        const prevMonthEnd = new Date(effectiveStart.getFullYear(), effectiveStart.getMonth(), 0, 23, 59, 59, 999);
        const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1, 0, 0, 0, 0);

        const prevMonthActiveThatExpire = subsAll.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;

          const wasActivePrevMonthEnd = isActiveAt(sub, prevMonthEnd);
          if (!wasActivePrevMonthEnd) return false;

          return ed >= effectiveStart && ed <= effectiveEnd;
        }).length;

        setPrevMonthActiveThatExpireThisPeriod(prevMonthActiveThatExpire);

        // ✅ Trimestrais iniciados no mês anterior (pra você ter noção da base trimestral do mês anterior)
        const prevMonthQuarterly = subsAll.filter((sub) => {
          const sd = getStartDate(sub);
          if (!sd || Number.isNaN(sd.getTime())) return false;

          const startedPrevMonth = sd >= prevMonthStart && sd <= prevMonthEnd;
          if (!startedPrevMonth) return false;

          const days = getPeriodDays(sub);
          const isQuarter = isQuarterlyByText(sub) || days >= 80;
          return isQuarter;
        }).length;

        setPrevMonthQuarterlyStarted(prevMonthQuarterly);

        // ✅ RENOVAÇÕES NO PERÍODO (last_renewed_at) — pode ficar 0 se não preenche
        if (start && end) {
          const renewedInPeriod = subsAll.filter((sub) => {
            const rd = getRenewedAt(sub);
            if (!rd) return false;
            return rd >= start && rd <= end;
          }).length;
          setRenewedCount(renewedInPeriod);
        } else {
          setRenewedCount(0);
        }

        // ✅ RECEITA (por plano/duração) — baseada nas ativas CORRETAS (snapshot)
        let monthlyCount = 0;
        let quarterlyCount = 0;
        let revenue = 0;

        activeSubsSnapshot.forEach((sub) => {
          const value = pickSubscriptionValue(sub);
          if (!value) return;

          const days = getPeriodDays(sub);
          const isQuarter = isQuarterlyByText(sub) || days >= 80;

          if (isQuarter) quarterlyCount += 1;
          else monthlyCount += 1;

          revenue += value;
        });

        setActiveMonthlyCount(monthlyCount);
        setActiveQuarterlyCount(quarterlyCount);

        const mrrMonthlyValue = monthlyCount * PRICE_MONTHLY;
        const mrrQuarterlyValue = quarterlyCount * (PRICE_QUARTERLY / 3);

        setMrrMonthly(mrrMonthlyValue);
        setMrrQuarterly(mrrQuarterlyValue);
        setMrr(mrrMonthlyValue + mrrQuarterlyValue);
        setTotalRevenue(revenue);

        // conversão (mantém lógica atual: ativos / usuários do período real)
        if (usersCount && usersCount > 0) {
          setConversionRate((activeSubsSnapshot.length / usersCount) * 100);
        } else {
          setConversionRate(0);
        }

        // retenção (mantém lógica atual: ativos / totalSubs (start no período real))
        if (subsForTotalByStart.length > 0) {
          setRetentionRate((activeSubsSnapshot.length / subsForTotalByStart.length) * 100);
        } else {
          setRetentionRate(0);
        }

        // lista perfis (amostra)
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

  const continuityPercent =
    prevMonthActiveThatExpireThisPeriod > 0
      ? (expiringRenewedDeduction / prevMonthActiveThatExpireThisPeriod) * 100
      : 0;

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
                    <option value="all">Tudo (usa mês atual no funil)</option>
                    <option value="today">Hoje</option>
                    <option value="7days">Últimos 7 dias</option>
                    <option value="month">Este mês</option>
                    <option value="lastmonth">Mês passado</option>
                    <option value="year">Ano atual</option>
                    <option value="custom">Período personalizado</option>
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
              {/* Métricas principais */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Assinaturas Ativas
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">
                    {activeSubscriptions}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Mensal: {activeMonthlyCount} · Trimestral: {activeQuarterlyCount}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ativas no período:{' '}
                    <span className="font-semibold text-slate-200">{activeInPeriodCount}</span>
                  </p>
                </div>

                {/* ✅ CARD: Ainda pra renovar no período (obedece filtro) */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Ainda pra renovar (no período)
                    </span>
                    <Users className="w-5 h-5 text-indigo-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">
                    {expiringToRenew}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Vencem no período:{' '}
                    <span className="font-semibold text-slate-200">{expiringInPeriodTotal}</span>
                    {' '}· Desistiram:{' '}
                    <span className="font-semibold text-slate-200">{expiringChurned}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Renovaram (dedução):{' '}
                    <span className="font-semibold text-slate-200">{expiringRenewedDeduction}</span>
                  </p>
                </div>

                {/* ✅ NOVO CARD: ATIVOS DO MÊS ANTERIOR QUE VENCEM NO PERÍODO + trimestrais do mês anterior */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Base do mês anterior que vence no período
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">
                    {prevMonthActiveThatExpireThisPeriod}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Continuidade (dedução):{' '}
                    <span className="font-semibold text-slate-200">
                      {expiringRenewedDeduction}
                    </span>
                    {' '}· Taxa:{' '}
                    <span className="font-semibold text-slate-200">
                      {formatPercent(continuityPercent)}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Trimestrais iniciados no mês anterior:{' '}
                    <span className="font-semibold text-slate-200">{prevMonthQuarterlyStarted}</span>
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Faturamento (período)
                    </span>
                    <CreditCard className="w-5 h-5 text-sky-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">
                    {formatCurrency(totalRevenue)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Aproximação: soma dos planos ativos.
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      MRR (total)
                    </span>
                    <CreditCard className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">
                    {formatCurrency(mrr)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Mensal + (Trimestral ÷ 3)
                  </p>
                </div>
              </section>

              {/* MRR separado */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      MRR Mensal
                    </span>
                    <CreditCard className="w-5 h-5 text-purple-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">
                    {formatCurrency(mrrMonthly)}
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      MRR Trimestral (÷ 3)
                    </span>
                    <CreditCard className="w-5 h-5 text-amber-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">
                    {formatCurrency(mrrQuarterly)}
                  </p>
                </div>
              </section>

              {/* Métricas adicionais */}
              <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Assinaturas Pendentes
                    </span>
                    <Clock className="w-5 h-5 text-amber-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{pendingSubscriptions}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Assinaturas Expiradas
                    </span>
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{expiredSubscriptions}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Retenção Geral
                    </span>
                    <BarChart3 className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">
                    {formatPercent(retentionRate)}
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Churn (período)
                    </span>
                    <AlertCircle className="w-5 h-5 text-rose-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">
                    {formatPercent(churnRate)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Perdeu:{' '}
                    <span className="font-semibold text-slate-200">{churnCount}</span>
                  </p>
                </div>
              </section>

              {/* Conversão + insights */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-purple-300" />
                    Taxa de Conversão
                  </h2>
                  <p className="text-3xl font-bold text-purple-300">
                    {formatPercent(conversionRate)}
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <h2 className="text-sm font-semibold text-slate-200 mb-3">
                    Insights rápidos
                  </h2>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li>
                      • Ticket médio (aprox.) por assinante ativo:{' '}
                      <span className="font-semibold">
                        {activeSubscriptions > 0
                          ? formatCurrency(mrr / activeSubscriptions)
                          : formatCurrency(0)}
                      </span>
                    </li>
                    <li>
                      • Assinaturas ativas neste momento:{' '}
                      <span className="font-semibold">{activeSubscriptions}</span>
                    </li>
                    <li>
                      • Pendentes que podem virar receita:{' '}
                      <span className="font-semibold">{pendingSubscriptions}</span>
                    </li>
                    <li>
                      • Renovaram no período (se last_renewed_at existir):{' '}
                      <span className="font-semibold">{renewedCount}</span>
                    </li>
                  </ul>
                </div>
              </section>

              {/* Tabela usuários por status */}
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
            </>
          )}
        </main>
      </div>
    </>
  );
};

export default AdminAnalyticsPage;
