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

const AdminAnalyticsPage = () => {
  // loading / erro
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // filtros
  const [filterType, setFilterType] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [appliedRangeLabel, setAppliedRangeLabel] = useState('Exibindo todos os dados');

  // ✅ métricas vindas do SQL (RPC)
  const [metrics, setMetrics] = useState({
    active_now: 0,
    due_in_period: 0,
    due_future: 0,
    due_past: 0,
    churned: 0,
    renewed_estimated: 0,
    sold_monthly: 0,
    sold_quarterly: 0,
  });

  // ✅ usuários (mantemos a tabela amostra)
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

        // ✅ Se não tiver filtro, usamos o mês atual como padrão pro SQL (01 -> 01/31)
        // porque o SQL precisa de range.
        let startTs = start;
        let endTs = end;

        if (!startTs || !endTs) {
          const now = new Date();
          const s = new Date(now.getFullYear(), now.getMonth(), 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          s.setHours(0, 0, 0, 0);
          e.setHours(23, 59, 59, 999);
          startTs = s;
          endTs = e;
        }

        // ✅ 1) CHAMA O SQL DOS DEUSES (RPC)
        const { data: rpcData, error: rpcError } = await supabase.rpc('admin_metrics_period', {
          start_ts: startTs.toISOString(),
          end_ts: endTs.toISOString(),
        });

        if (rpcError) throw rpcError;

        const row = Array.isArray(rpcData) && rpcData.length > 0 ? rpcData[0] : null;

        setMetrics({
          active_now: Number(row?.active_now || 0),
          due_in_period: Number(row?.due_in_period || 0),
          due_future: Number(row?.due_future || 0),
          due_past: Number(row?.due_past || 0),
          churned: Number(row?.churned || 0),
          renewed_estimated: Number(row?.renewed_estimated || 0),
          sold_monthly: Number(row?.sold_monthly || 0),
          sold_quarterly: Number(row?.sold_quarterly || 0),
        });

        // ✅ 2) TABELA (amostra) — mantém do jeito antigo, mas sem quebrar o painel
        // (se quiser, depois a gente também passa isso pra SQL)
        const { data: subsAll, error: subsError } = await supabase
          .from('subscriptions')
          .select('*');

        if (subsError) throw subsError;

        // amostra perfis
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

        const nowSnap = new Date();

        const getStartDate = (sub) =>
          new Date(
            sub.start_at ||
              sub.current_period_start ||
              sub.period_start ||
              sub.created_at ||
              sub.start_at
          );

        const getEndDate = (sub) =>
          new Date(
            sub.end_at ||
              sub.current_period_end ||
              sub.expires_at ||
              sub.period_end ||
              sub.end_at
          );

        const isActiveAt = (sub, at) => {
          const s = getStartDate(sub);
          const e = getEndDate(sub);
          if (!at || !s || !e) return false;
          if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || Number.isNaN(at.getTime())) {
            return false;
          }
          return s <= at && e > at;
        };

        const activeUsers = [];
        const pendingUsers = [];
        const inactiveUsers = [];

        (profilesList || []).forEach((profile) => {
          const userSubs = (subsAll || []).filter((s) => s.user_id === profile.id);

          let status = 'inactive';

          const hasActive = userSubs.some((s) => isActiveAt(s, nowSnap));
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

  // ✅ derivados simples (só conta, não inventa regra)
  const activeSubscriptions = metrics.active_now;

  const soldTotal = metrics.sold_monthly + metrics.sold_quarterly;

  // ✅ receita/mrr aproximados (só pra exibir dinheiro)
  const mrrMonthly = metrics.active_now > 0 ? metrics.active_now * 0 : 0; // placeholder (não usado)
  // Melhor: estimar por ativos com split mensal/trimestral vindo do SQL (se você quiser, eu adiciono no SQL)
  // Por enquanto, mantemos um cálculo simples baseado no que você já tem:
  // MRR ≈ (ativos mensais * PRICE_MONTHLY) + (ativos trimestrais * (PRICE_QUARTERLY/3))
  // Como o SQL atual não manda "ativos mensais/trimestrais", vamos estimar pela proporção de vendas do período:
  const totalRevenueApprox =
    (metrics.sold_monthly * PRICE_MONTHLY) + (metrics.sold_quarterly * PRICE_QUARTERLY);

  const mrrApprox = 0; // deixamos 0 pra não mentir sem ter split real de ativos
  const churnRate =
    metrics.due_in_period > 0 ? (metrics.churned / metrics.due_in_period) * 100 : 0;

  // conversão: sem contar users aqui (pra não misturar); se quiser, faço via SQL também.
  const conversionRate = 0;

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
                    <option value="all">Tudo (usa mês atual no SQL)</option>
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
              {/* ✅ Cards principais (SQL) */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Assinaturas Ativas
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{metrics.active_now}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    (ativo agora) — vindo do SQL
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Vencem no período
                    </span>
                    <Users className="w-5 h-5 text-indigo-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{metrics.due_in_period}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Quem tem end_at dentro do período
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Já venceu (até agora)
                    </span>
                    <AlertCircle className="w-5 h-5 text-rose-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{metrics.due_past}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    end_at &lt;= agora (dentro do período)
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Churn (período)
                    </span>
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">
                    {formatPercent(churnRate)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Perdeu:{' '}
                    <span className="font-semibold text-slate-200">{metrics.churned}</span>
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 shadow-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Renovaram (estimado)
                    </span>
                    <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                  </div>
                  <p className="mt-3 text-3xl font-bold text-slate-50">{metrics.renewed_estimated}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Calculado pelo SQL (aprox.)
                  </p>
                </div>
              </section>

              {/* ✅ Vendas no período (SQL) */}
              <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Entraram no período
                    </span>
                    <CreditCard className="w-5 h-5 text-purple-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{soldTotal}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Mensal: {metrics.sold_monthly} · Trimestral: {metrics.sold_quarterly}
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Faturamento (aprox.)
                    </span>
                    <CreditCard className="w-5 h-5 text-sky-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{formatCurrency(totalRevenueApprox)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    (Mensal * {PRICE_MONTHLY}) + (Trimestral * {PRICE_QUARTERLY})
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs uppercase tracking-wide text-slate-400">
                      Vencem depois
                    </span>
                    <Clock className="w-5 h-5 text-amber-300" />
                  </div>
                  <p className="text-2xl font-bold text-slate-50">{metrics.due_future}</p>
                  <p className="mt-1 text-xs text-slate-500">end_at &gt; agora</p>
                </div>
              </section>

              {/* Conversão + insights (mantido simples) */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <h2 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-purple-300" />
                    Taxa de Conversão
                  </h2>
                  <p className="text-3xl font-bold text-purple-300">
                    {formatPercent(conversionRate)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    (Se quiser conversão real via SQL, eu adiciono na função)
                  </p>
                </div>

                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
                  <h2 className="text-sm font-semibold text-slate-200 mb-3">
                    Insights rápidos
                  </h2>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li>
                      • Assinaturas ativas agora:{' '}
                      <span className="font-semibold">{metrics.active_now}</span>
                    </li>
                    <li>
                      • Vencem no período:{' '}
                      <span className="font-semibold">{metrics.due_in_period}</span>
                    </li>
                    <li>
                      • Já venceu (até agora):{' '}
                      <span className="font-semibold">{metrics.due_past}</span>
                    </li>
                    <li>
                      • Renovaram (estimado):{' '}
                      <span className="font-semibold">{metrics.renewed_estimated}</span>
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
