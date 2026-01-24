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
const PRICE_QUARTERLY = 38.9; // <-- se o seu trimestral for outro valor, troca aqui

// ✅ Quantos dias de "tolerância" pra considerar renovação (Pix/manual às vezes paga depois)
const RENEW_GRACE_DAYS = 2;

// Abas do painel admin (Analytics | Doramas | Usuários)
const AdminTopNav = ({ current }) => {
  const navigate = useNavigate();

  const items = [
    { id: 'analytics', label: 'Analytics', path: '/admin/analytics' },
    { id: 'doramas', label: 'Doramas', path: '/admin/doramas' },
    // ✅ ajuste (tava /admin/admin/users)
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

// ✅ AJUSTE: prioriza os campos que EXISTEM na sua tabela (start_at / end_at)
const getEndDate = (sub) =>
  new Date(sub.end_at || sub.current_period_end || sub.expires_at || sub.period_end || sub.end_at);

const getStartDate = (sub) =>
  new Date(sub.start_at || sub.current_period_start || sub.period_start || sub.created_at || sub.start_at);

// ✅ NOVO: regra consistente pra saber se está "ativo" em uma data (snapshot)
// Ativo em T = start <= T  e  end > T
const isActiveAt = (sub, at) => {
  const s = getStartDate(sub);
  const e = getEndDate(sub);
  if (!at || !s || !e) return false;
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || Number.isNaN(at.getTime())) {
    return false;
  }
  return s <= at && e > at;
};

// ✅ NOVO: esteve ativo em ALGUM MOMENTO dentro do período [rangeStart, rangeEnd]
// Interseção do intervalo da assinatura com o intervalo do filtro
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
  // Intersecta se start <= rangeEnd  e  end > rangeStart
  return s <= rangeEnd && e > rangeStart;
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

  // 2) fallback: calcula por plano/duração (FRONT)
  const days = getPeriodDays(sub);

  // texto bate primeiro
  if (isQuarterlyByText(sub)) return PRICE_QUARTERLY;
  if (isMonthlyByText(sub)) return PRICE_MONTHLY;

  // duração como fallback final
  if (days >= 80) return PRICE_QUARTERLY;
  return PRICE_MONTHLY;
};

// ✅ NOVO: verifica se houve "renovação por continuidade"
// Regra: para um sub que terminou em X, existe outro sub do mesmo user começando até X + graceDays
const didRenewByContinuity = (endedSub, subsAll, graceDays = RENEW_GRACE_DAYS) => {
  const end = getEndDate(endedSub);
  if (!end || Number.isNaN(end.getTime())) return false;

  const limit = new Date(end);
  limit.setDate(limit.getDate() + graceDays);
  limit.setHours(23, 59, 59, 999);

  return subsAll.some((s2) => {
    if (!s2 || s2.user_id !== endedSub.user_id) return false;

    const s2Start = getStartDate(s2);
    if (!s2Start || Number.isNaN(s2Start.getTime())) return false;

    // novo começa depois do fim e até o limite
    return s2Start > end && s2Start <= limit;
  });
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

  // ✅ NOVO: ativas no período (em algum momento)
  const [activeInPeriodCount, setActiveInPeriodCount] = useState(0);

  /**
   * ✅ MÊS/PERÍODO BASE: agora baseado em "quem precisava renovar"
   *
   * Definições:
   * - Base do período: assinaturas com end_at dentro do período selecionado (ou mês passado se sem filtro)
   * - Renovaram: vencidas no período (end_at <= snapshotAt) e com nova assinatura em até N dias
   * - Desistiram: vencidas no período (end_at <= snapshotAt) e sem nova assinatura
   * - Ainda pra renovar: end_at dentro do período, mas end_at > snapshotAt (ainda não venceu)
   */
  const [prevMonthBase, setPrevMonthBase] = useState(0); // total que "vence no período"
  const [prevMonthStillActive, setPrevMonthStillActive] = useState(0); // ainda pra renovar (não venceu ainda)
  const [prevMonthToExpire, setPrevMonthToExpire] = useState(0); // desistiram (venceram e não renovaram)
  const [prevMonthRenewed, setPrevMonthRenewed] = useState(0); // renovaram (continuidade)

  // ✅ receita
  const [mrr, setMrr] = useState(0);
  const [mrrMonthly, setMrrMonthly] = useState(0);
  const [mrrQuarterly, setMrrQuarterly] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);

  // ✅ contagens por plano (ativo)
  const [activeMonthlyCount, setActiveMonthlyCount] = useState(0);
  const [activeQuarterlyCount, setActiveQuarterlyCount] = useState(0);

  const [conversionRate, setConversionRate] = useState(0);
  const [retentionRate, setRetentionRate] = useState(0);

  // ✅ churn no período
  const [churnRate, setChurnRate] = useState(0);
  const [churnCount, setChurnCount] = useState(0);

  // ✅ renovações no período (AGORA por continuidade)
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

        // Label amigável do período
        if (!start || !end) {
          setAppliedRangeLabel('Exibindo todos os dados');
        } else {
          const fmt = (d) =>
            d.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            });
          setAppliedRangeLabel(`Período: ${fmt(start)} até ${fmt(end)}`);
        }

        // TOTAL USERS
        let profilesCountQuery = supabase.from('profiles').select('id', { count: 'exact', head: true });

        if (start && end) {
          profilesCountQuery = profilesCountQuery.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
        }

        const { count: usersCount, error: usersError } = await profilesCountQuery;
        if (usersError) throw usersError;
        setTotalUsers(usersCount || 0);

        // SUBSCRIPTIONS (busca tudo e filtra no FRONT por start)
        const { data: subsDataAll, error: subsError } = await supabase.from('subscriptions').select('*');
        if (subsError) throw subsError;

        const subsAll = subsDataAll || [];

        // ✅ Snapshot: se o período já acabou, usa o final do período como "data de referência"
        // se o período ainda está em andamento, usa o NOW
        const now = new Date();
        const snapshotAt = end && end < now ? end : now;

        // ✅ Para "ativas no período": se o período termina no futuro, conta só até agora (snapshotAt)
        const rangeEndEffective = start && end ? (end > now ? snapshotAt : end) : null;

        const isInRangeByStart = (sub) => {
          if (!start || !end) return true;
          const sd = getStartDate(sub);
          if (!sd || Number.isNaN(sd.getTime())) return false;
          return sd >= start && sd <= end;
        };

        // ✅ IMPORTANTÍSSIMO: manter totalSubscriptions como está (por start no período)
        const subs = subsAll.filter(isInRangeByStart);
        const totalSubs = subs.length;
        setTotalSubscriptions(totalSubs);

        // ✅ ATIVOS CORRETOS (foto): ativo = start <= snapshotAt e end > snapshotAt
        const activeSubsSnapshot = subsAll.filter((sub) => isActiveAt(sub, snapshotAt));
        setActiveSubscriptions(activeSubsSnapshot.length);

        // ✅ NOVO: ATIVAS NO PERÍODO (em algum momento)
        if (start && end && rangeEndEffective) {
          const activeSomeTimeInRange = subsAll.filter((sub) => wasActiveInRange(sub, start, rangeEndEffective)).length;
          setActiveInPeriodCount(activeSomeTimeInRange);
        } else {
          // sem filtro: mantém igual a foto atual
          setActiveInPeriodCount(activeSubsSnapshot.length);
        }

        /**
         * ✅ PERÍODO BASE PARA "RENOVOU / AINDA PRA RENOVAR / DESISTIU"
         *
         * Regra:
         * - Se você selecionou um período (start/end): esse é o período base.
         * - Se não tem filtro (Tudo): período base = mês passado.
         */
        let baseStart = null;
        let baseEnd = null;

        if (start && end) {
          baseStart = new Date(start);
          baseEnd = new Date(end);
          baseStart.setHours(0, 0, 0, 0);
          baseEnd.setHours(23, 59, 59, 999);
        } else {
          // sem filtro -> mês passado
          const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const e = new Date(now.getFullYear(), now.getMonth(), 0);
          s.setHours(0, 0, 0, 0);
          e.setHours(23, 59, 59, 999);
          baseStart = s;
          baseEnd = e;
        }

        // Base: assinaturas que "vencem" dentro do período (end_at no período)
        const baseEndingSubs = subsAll.filter((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return false;
          return ed >= baseStart && ed <= baseEnd;
        });

        const baseTotalEnding = baseEndingSubs.length;

        // Separação:
        // - já venceu (end_at <= snapshotAt): decide se renovou ou desistiu
        // - ainda não venceu (end_at > snapshotAt): ainda pra renovar
        let stillToRenew = 0;
        let renewedByContinuity = 0;
        let churnedByNoRenew = 0;

        baseEndingSubs.forEach((sub) => {
          const ed = getEndDate(sub);
          if (!ed || Number.isNaN(ed.getTime())) return;

          if (ed > snapshotAt) {
            stillToRenew += 1;
            return;
          }

          // já venceu
          const renewed = didRenewByContinuity(sub, subsAll, RENEW_GRACE_DAYS);
          if (renewed) renewedByContinuity += 1;
          else churnedByNoRenew += 1;
        });

        setPrevMonthBase(baseTotalEnding);
        setPrevMonthStillActive(stillToRenew); // "ainda pra renovar"
        setPrevMonthRenewed(renewedByContinuity); // "renovaram"
        setPrevMonthToExpire(churnedByNoRenew); // "desistiram"

        // Pendentes (mantém comportamento: pendentes do recorte por start do período)
        const pendingSubs = subs.filter((sub) =>
          ['pending', 'incomplete', 'requires_payment_method'].includes(sub.status)
        );
        setPendingSubscriptions(pendingSubs.length);

        // ✅ Expiradas do PERÍODO: assinaturas que venceram dentro do intervalo selecionado
        // Se não tiver período, expirada = end <= snapshotAt (até agora)
        const expiredSubs =
          start && end
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

        // ✅ CHURN NO PERÍODO (vencidos dentro do período)
        if (start && end) {
          const churnedInPeriod = subsAll.filter((sub) => {
            const endDate = getEndDate(sub);
            if (!endDate || Number.isNaN(endDate.getTime())) return false;

            const endedInPeriod = endDate >= start && endDate <= end;
            const endedBySnapshot = endDate <= snapshotAt;

            return endedInPeriod && endedBySnapshot;
          }).length;

          setChurnCount(churnedInPeriod);

          // base aproximada: quem estava ativo na "foto" + quem venceu no período
          const base = activeSubsSnapshot.length + churnedInPeriod;
          setChurnRate(base > 0 ? (churnedInPeriod / base) * 100 : 0);
        } else {
          setChurnRate(0);
          setChurnCount(0);
        }

        // ✅ RENOVAÇÕES NO PERÍODO (AGORA via continuidade)
        if (start && end) {
          // pega as que venceram no período até snapshotAt e conta as que renovaram
          const endedInPeriod = subsAll.filter((sub) => {
            const ed = getEndDate(sub);
            if (!ed || Number.isNaN(ed.getTime())) return false;
            return ed >= start && ed <= end && ed <= snapshotAt;
          });

          let renewedInPeriod = 0;
          endedInPeriod.forEach((sub) => {
            if (didRenewByContinuity(sub, subsAll, RENEW_GRACE_DAYS)) renewedInPeriod += 1;
          });

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

        // conversão (mantém lógica atual: ativos / usuários criados no período)
        if (usersCount && usersCount > 0) {
          setConversionRate((activeSubsSnapshot.length / usersCount) * 100);
        } else {
          setConversionRate(0);
        }

        // retenção (mantém lógica atual: ativos / totalSubs no recorte por start)
        if (totalSubs > 0) {
          setRetentionRate((activeSubsSnapshot.length / totalSubs) * 100);
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
          profilesListQuery = profilesListQuery.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
        }

        const { data: profilesList, error: profilesListError } = await profilesListQuery;
        if (profilesListError) throw profilesListError;

        const activeUsers = [];
        const pendingUsers = [];
        const inactiveUsers = [];

        (profilesList || []).forEach((profile) => {
          const userSubs = subsAll.filter((s) => s.user_id === profile.id);

          let status = 'inactive';

          // ✅ Status do usuário baseado na mesma "foto" (snapshotAt)
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

  // ✅ Retenção do bloco "vencimentos no período": renovaram / total que venceu (base)
  // Aqui é uma taxa útil pra leitura rápida
  const prevMonthRetentionPercent = prevMonthBase > 0 ? (prevMonthRenewed / prevMonthBase) * 100 : 0;

  // ✅ "Taxa de renovação" = igual (mantém o card e o cálculo simples)
  const prevMonthRenewedPercent = prevMonthBase > 0 ? (prevMonthRenewed / prevMonthBase) * 100 : 0;

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
                    <option value="all">Tudo (sem filtro)</option>
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
                    <span className="text-xs uppercase tracking-wide text-slate-400">Assinaturas Ativas</span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{activeSubscriptions}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Mensal: {activeMonthlyCount} · Trimestral: {activeQuarterlyCount}
                  </p>

                  {/* ✅ NOVO: mostra quantas estiveram ativas no período (em algum momento) */}
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ativas no período:{' '}
                    <span className="font-semibold text-slate-200">{activeInPeriodCount}</span>
                  </p>
                </div>

                {/* ✅ Card "período base" (mês passado ou período escolhido): ainda pra renovar */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Ainda pra renovar (no período)
                    </span>
                    <Users className="w-5 h-5 text-indigo-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{prevMonthStillActive}</p>

                  <p className="mt-1 text-[11px] text-slate-500">
                    Vencem no período:{' '}
                    <span className="font-semibold text-slate-200">{prevMonthBase}</span>
                    {' '}· Taxa de renovação:{' '}
                    <span className="font-semibold text-slate-200">{formatPercent(prevMonthRetentionPercent)}</span>
                  </p>

                  <p className="mt-1 text-[11px] text-slate-500">
                    Desistiram (venceram e não renovaram):{' '}
                    <span className="font-semibold text-slate-200">{prevMonthToExpire}</span>
                  </p>
                </div>

                {/* ✅ NOVO CARD: RENOVARAM NO PERÍODO (continuidade) */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Renovaram (continuidade)
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{prevMonthRenewed}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    % dos que venciam:{' '}
                    <span className="font-semibold text-slate-200">{formatPercent(prevMonthRenewedPercent)}</span>
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Faturamento (período)</span>
                    <CreditCard className="w-5 h-5 text-sky-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(totalRevenue)}</p>
                  <p className="mt-1 text-xs text-slate-500">Aproximação: soma dos planos ativos.</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">MRR (total)</span>
                    <CreditCard className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{formatCurrency(mrr)}</p>
                  <p className="mt-1 text-xs text-slate-500">Mensal + (Trimestral ÷ 3)</p>
                </div>
              </section>

              {/* MRR separado */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">MRR Mensal</span>
                    <CreditCard className="w-5 h-5 text-purple-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{formatCurrency(mrrMonthly)}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">MRR Trimestral (÷ 3)</span>
                    <CreditCard className="w-5 h-5 text-amber-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{formatCurrency(mrrQuarterly)}</p>
                </div>
              </section>

              {/* Métricas adicionais */}
              <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Assinaturas Pendentes</span>
                    <Clock className="w-5 h-5 text-amber-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{pendingSubscriptions}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Assinaturas Expiradas</span>
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{expiredSubscriptions}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Retenção Geral</span>
                    <BarChart3 className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{formatPercent(retentionRate)}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Churn (período)</span>
                    <AlertCircle className="w-5 h-5 text-rose-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{formatPercent(churnRate)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Perdeu: <span className="font-semibold text-slate-200">{churnCount}</span>
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
                  <p className="text-3xl font-bold text-purple-300">{formatPercent(conversionRate)}</p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <h2 className="text-sm font-semibold text-slate-200 mb-3">Insights rápidos</h2>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li>
                      • Ticket médio (aprox.) por assinante ativo:{' '}
                      <span className="font-semibold">
                        {activeSubscriptions > 0 ? formatCurrency(mrr / activeSubscriptions) : formatCurrency(0)}
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
                      • Renovaram no período:{' '}
                      <span className="font-semibold">{renewedCount}</span>
                    </li>
                  </ul>
                </div>
              </section>

              {/* Tabela usuários por status */}
              <section className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-5 h-5 text-indigo-300" />
                  <h2 className="text-sm font-semibold text-slate-200">Usuários por status (amostra)</h2>
                </div>

                {combinedUsers.length === 0 ? (
                  <p className="text-xs sm:text-sm text-slate-400">Nenhum usuário encontrado para o período selecionado.</p>
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
                              <span className={`text-xs font-semibold ${u.statusColor}`}>{u.statusLabel}</span>
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
