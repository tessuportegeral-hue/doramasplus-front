// src/pages/AdminAnalytics.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import {
  BarChart3,
  Users,
  CreditCard,
  AlertCircle,
  Clock,
  Loader2,
  Calendar,
  TrendingUp,
  TrendingDown,
  UserPlus,
  UserMinus,
} from "lucide-react";

/**
 * ✅ AJUSTE OS PREÇOS AQUI (em reais)
 * - Mensal: DoramaPlay Padrão
 * - Trimestral: DoramaPlay Trimestral
 */
const PRICE_MONTHLY = 15.9;
const PRICE_QUARTERLY = 43.9;

/** Helpers */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDateInputValue(d) {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
}
function fromDateInputValue(v) {
  if (!v) return null;
  const [yyyy, mm, dd] = v.split("-").map((x) => parseInt(x, 10));
  if (!yyyy || !mm || !dd) return null;
  return new Date(`${v}T00:00:00-03:00`);
}
function startOfDay(d) {
  return new Date(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T00:00:00-03:00`);
}
function endOfDay(d) {
  return new Date(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T23:59:59.999-03:00`);
}
function startOfMonth(d) {
  return new Date(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01T00:00:00-03:00`);
}
function endOfMonth(d) {
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return new Date(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(lastDay)}T23:59:59.999-03:00`);
}
function addMonths(d, months) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}
function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function toISO(d) {
  return d ? d.toISOString() : null;
}
function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}
function formatBRL(value) {
  const v = safeNum(value);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatPct(value) {
  const v = safeNum(value);
  return `${v.toFixed(2)}%`;
}
function formatBRDate(d) {
  if (!d) return "-";
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function AdminAnalytics() {
  const navigate = useNavigate();
  const location = useLocation();

  // Gate admin
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Assistindo ao vivo
  const [viewersNow, setViewersNow] = useState(null);

  useEffect(() => {
    const fetchViewers = async () => {
      const { count } = await supabase
        .from('playback_sessions')
        .select('user_id', { count: 'exact', head: true })
        .gt('last_heartbeat', new Date(Date.now() - 25000).toISOString());
      setViewersNow(count ?? 0);
    };
    fetchViewers();
    const id = setInterval(fetchViewers, 20000);
    return () => clearInterval(id);
  }, []);

  // Filtro de período
  const [quickPeriod, setQuickPeriod] = useState("this_month"); // this_month | last_month | custom
  const [startDateStr, setStartDateStr] = useState("");
  const [endDateStr, setEndDateStr] = useState("");

  // Período de comparação (churn/retenção) — por padrão, mês anterior ao período principal
  const [comparePeriod, setComparePeriod] = useState("prev_month"); // prev_month | custom
  const [compareStartDateStr, setCompareStartDateStr] = useState("");
  const [compareEndDateStr, setCompareEndDateStr] = useState("");

  // Estado de carregamento / erro
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Avisos não-fatais (ex.: VIEW/RLS)
  const [warning, setWarning] = useState("");

  // Métricas do RPC (periodizadas)
  const [metrics, setMetrics] = useState({
    active_now: 0,
    active_now_monthly: 0,
    active_now_quarterly: 0,

    pending_now: 0,
    pending_in_period: 0,

    sold_total: 0,
    sold_monthly: 0,
    sold_quarterly: 0,

    revenue_estimated_in_period: 0,

    mrr_total_estimated: 0,
    mrr_monthly_estimated: 0,
    mrr_quarterly_estimated: 0,
  });

  // Retenção D30
  const [retD30, setRetD30] = useState({
    base_com_30_dias: 0,
    ainda_ativos: 0,
    retencao_d30: 0,
  });

  // Churn / retenção do período (+ período de comparação)
  const [churn, setChurn] = useState({
    period: { new: 0, cohort: 0, retained: 0, churned: 0, retention_rate: 0 },
    compare_period: { new: 0, cohort: 0, retained: 0, churned: 0, retention_rate: 0, period_start: null, period_end: null },
  });


  // Datas derivadas (de acordo com quickPeriod + inputs)
  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    const now = new Date();

    if (quickPeriod === "last_month") {
      const ref = addMonths(now, -1);
      const s = startOfMonth(ref);
      const e = endOfMonth(ref);
      return {
        periodStart: s,
        periodEnd: e,
        periodLabel: `Período: ${toDateInputValue(s).split("-").reverse().join("/")} até ${toDateInputValue(e)
          .split("-")
          .reverse()
          .join("/")}`,
      };
    }

    if (quickPeriod === "custom") {
      const s = fromDateInputValue(startDateStr);
      const e = fromDateInputValue(endDateStr);
      const valid = s && e && s <= e;

      if (!valid) {
        // fallback (este mês até hoje)
        const s2 = startOfMonth(now);
        return {
          periodStart: s2,
          periodEnd: now,
          periodLabel: `Período: ${toDateInputValue(s2).split("-").reverse().join("/")} até ${toDateInputValue(now)
            .split("-")
            .reverse()
            .join("/")} (mês em andamento)`,
        };
      }

      const sDay = startOfDay(s);
      const eDay = endOfDay(e);

      return {
        periodStart: sDay,
        periodEnd: eDay,
        periodLabel: `Período: ${toDateInputValue(sDay).split("-").reverse().join("/")} até ${toDateInputValue(eDay)
          .split("-")
          .reverse()
          .join("/")}`,
      };
    }

    // this_month (default) — vai do dia 1 até HOJE, não até o fim do mês
    // (mês ainda em andamento; mostrar "até dia 30" quando só estamos no dia
    // 14 confundia e não representava os dados de verdade).
    const s = startOfMonth(now);
    return {
      periodStart: s,
      periodEnd: now,
      periodLabel: `Período: ${toDateInputValue(s).split("-").reverse().join("/")} até ${toDateInputValue(now)
        .split("-")
        .reverse()
        .join("/")} (mês em andamento)`,
    };
  }, [quickPeriod, startDateStr, endDateStr]);

  // Inicializa inputs quando muda o quickPeriod
  useEffect(() => {
    const now = new Date();
    if (quickPeriod === "this_month") {
      const s = startOfMonth(now);
      const e = endOfMonth(now);
      setStartDateStr(toDateInputValue(s));
      setEndDateStr(toDateInputValue(e));
    }
    if (quickPeriod === "last_month") {
      const ref = addMonths(now, -1);
      const s = startOfMonth(ref);
      const e = endOfMonth(ref);
      setStartDateStr(toDateInputValue(s));
      setEndDateStr(toDateInputValue(e));
    }
    // custom não mexe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickPeriod]);

  // Datas derivadas do período de COMPARAÇÃO (churn/retenção)
  const { compareStart, compareEnd, compareLabel } = useMemo(() => {
    if (comparePeriod === "custom") {
      const s = fromDateInputValue(compareStartDateStr);
      const e = fromDateInputValue(compareEndDateStr);
      const valid = s && e && s <= e;
      if (valid) {
        const sDay = startOfDay(s);
        const eDay = endOfDay(e);
        return {
          compareStart: sDay,
          compareEnd: eDay,
          compareLabel: `${toDateInputValue(sDay).split("-").reverse().join("/")} até ${toDateInputValue(eDay)
            .split("-")
            .reverse()
            .join("/")}`,
        };
      }
    }
    // prev_month (default): mesmo intervalo de dias do período principal, um mês
    // antes. Ex.: período principal 01/07 até 14/07 (mês em andamento) compara
    // com 01/06 até 14/06 — mesma quantidade de dias, não o mês inteiro passado
    // (comparar 14 dias com 30 dias dava número torto e confuso).
    const s = startOfMonth(addMonths(periodStart, -1));
    const durationMs = periodEnd.getTime() - periodStart.getTime();
    const e = new Date(s.getTime() + durationMs);
    return {
      compareStart: s,
      compareEnd: e,
      compareLabel: `${toDateInputValue(s).split("-").reverse().join("/")} até ${toDateInputValue(e)
        .split("-")
        .reverse()
        .join("/")} (mesma quantidade de dias, um mês antes)`,
    };
  }, [comparePeriod, compareStartDateStr, compareEndDateStr, periodStart, periodEnd]);

  // Inicializa inputs do período de comparação quando muda o modo
  useEffect(() => {
    if (comparePeriod === "prev_month") {
      const s = startOfMonth(addMonths(periodStart, -1));
      const durationMs = periodEnd.getTime() - periodStart.getTime();
      const e = new Date(s.getTime() + durationMs);
      setCompareStartDateStr(toDateInputValue(s));
      setCompareEndDateStr(toDateInputValue(e));
    }
    // custom não mexe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparePeriod, periodStart, periodEnd]);

  // ✅ Gate admin (mais seguro)
  useEffect(() => {
    let mounted = true;

    const checkAdmin = async () => {
      try {
        setAdminChecked(false);
        setIsAdmin(false);

        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;

        if (!user) {
          navigate("/login");
          return;
        }

        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("id, is_admin")
          .eq("id", user.id)
          .maybeSingle();

        if (profErr) {
          console.warn("profiles check error:", profErr);
          if (mounted) {
            setIsAdmin(false);
            setAdminChecked(true);
            setError("Sem permissão para validar admin (profiles).");
          }
          return;
        }

        const ok = prof?.is_admin === true;

        if (!ok) {
          navigate("/");
          return;
        }

        if (mounted) {
          setIsAdmin(true);
          setAdminChecked(true);
        }
      } catch (e) {
        console.warn("admin gate error:", e);
        if (mounted) {
          setIsAdmin(false);
          setAdminChecked(true);
          setError("Falha ao validar admin.");
        }
      }
    };

    checkAdmin();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const fetchAllMetrics = useCallback(async () => {
    if (!adminChecked || !isAdmin) return;

    setLoading(true);
    setError("");
    setWarning("");

    try {
      // ---- 1-4. Ativos + métricas PIX/Stripe/manual via edge function ----
      // (antes calculava "ativos" aqui direto no front com .gt('end_at', now),
      // o que excluía quem tem end_at nulo (Stripe sem data fixa, normal) e
      // classificava mensal/trimestral só por ilike no plan_name, perdendo
      // toda linha antiga com plan_name nulo. Agora vem pronto e correto da
      // function, com a mesma regra do gate de premium.)
      const { data: pix, error: pixErr } = await supabase.functions.invoke("admin-analytics", {
        body: {
          period_start: toISO(periodStart),
          period_end: toISO(periodEnd),
          compare_period_start: toISO(compareStart),
          compare_period_end: toISO(compareEnd),
        },
      });
      if (pixErr) throw new Error(`admin-analytics: ${pixErr.message}`);

      const activeNow = safeNum(pix.active_now);
      const activeMonthly = safeNum(pix.active_now_monthly);
      const activeQuarterly = safeNum(pix.active_now_quarterly);
      const mrrMonthlyVal = activeMonthly * PRICE_MONTHLY;
      const mrrQuarterlyVal = (activeQuarterly * PRICE_QUARTERLY) / 3;
      const mrrTotalVal = mrrMonthlyVal + mrrQuarterlyVal;

      setMetrics({
        active_now: activeNow,
        active_now_monthly: activeMonthly,
        active_now_quarterly: activeQuarterly,
        pending_now: safeNum(pix.pending_now),
        pending_in_period: safeNum(pix.pending_in_period),
        sold_total: safeNum(pix.sold_total),
        sold_monthly: safeNum(pix.sold_monthly),
        sold_quarterly: safeNum(pix.sold_quarterly),
        revenue_estimated_in_period: safeNum(pix.revenue_period),
        mrr_total_estimated: mrrTotalVal,
        mrr_monthly_estimated: mrrMonthlyVal,
        mrr_quarterly_estimated: mrrQuarterlyVal,
      });

      setRetD30({
        base_com_30_dias: safeNum(pix.d30_base),
        ainda_ativos: safeNum(pix.d30_retained),
        retencao_d30: safeNum(pix.d30_rate),
      });

      const churnPeriod = pix.churn?.period || {};
      const churnCompare = pix.churn?.compare_period || {};
      setChurn({
        period: {
          new: safeNum(churnPeriod.new),
          cohort: safeNum(churnPeriod.cohort),
          retained: safeNum(churnPeriod.retained),
          churned: safeNum(churnPeriod.churned),
          retention_rate: safeNum(churnPeriod.retention_rate),
        },
        compare_period: {
          new: safeNum(churnCompare.new),
          cohort: safeNum(churnCompare.cohort),
          retained: safeNum(churnCompare.retained),
          churned: safeNum(churnCompare.churned),
          retention_rate: safeNum(churnCompare.retention_rate),
          period_start: churnCompare.period_start || null,
          period_end: churnCompare.period_end || null,
        },
      });
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  }, [adminChecked, isAdmin, periodStart, periodEnd, compareStart, compareEnd]);

  useEffect(() => {
    if (!adminChecked) return;
    if (!isAdmin) return;
    fetchAllMetrics();
  }, [adminChecked, isAdmin, fetchAllMetrics]);

  // Derivados
  const revenuePeriod = useMemo(
    () => safeNum(metrics.revenue_estimated_in_period),
    [metrics.revenue_estimated_in_period]
  );
  const mrrTotal = useMemo(
    () => safeNum(metrics.mrr_total_estimated),
    [metrics.mrr_total_estimated]
  );
  const mrrMonthly = useMemo(
    () => safeNum(metrics.mrr_monthly_estimated),
    [metrics.mrr_monthly_estimated]
  );
  const mrrQuarterly = useMemo(
    () => safeNum(metrics.mrr_quarterly_estimated),
    [metrics.mrr_quarterly_estimated]
  );

  const avgTicket = useMemo(() => {
    const denom = safeNum(metrics.active_now);
    if (!denom) return 0;
    return mrrTotal / denom;
  }, [metrics.active_now, mrrTotal]);

  // “Janela” explicativa da Retenção D30 (pra não confundir com o filtro do período)
  const retentionWindowLabel = useMemo(() => {
    const today = new Date();
    const cohortStart = addDays(today, -60);
    const cohortEnd = addDays(today, -30);
    return `Coorte: ${formatBRDate(cohortStart)} até ${formatBRDate(cohortEnd)} • Medição em: ${formatBRDate(today)}`;
  }, []);

  // UI
  const renderCard = (title, value, icon, subtitle, tone = "default") => {
    const toneClasses =
      tone === "ok"
        ? "border-green-500/30"
        : tone === "warn"
        ? "border-yellow-500/30"
        : tone === "bad"
        ? "border-red-500/30"
        : "border-white/10";

    return (
      <div className={`rounded-2xl bg-white/5 border ${toneClasses} p-4 md:p-5 shadow-sm`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs md:text-sm text-white/70 font-medium">{title}</div>
            <div className="text-2xl md:text-3xl font-semibold mt-1 truncate">{value}</div>
            {subtitle ? <div className="text-xs md:text-sm text-white/50 mt-1">{subtitle}</div> : null}
          </div>
          <div className="shrink-0 opacity-80">{icon}</div>
        </div>
      </div>
    );
  };

  const goTab = (path) => {
    navigate(path);
  };

  const isActiveRoute = (path) => {
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  // Enquanto valida admin
  if (!adminChecked && !error) {
    return (
      <div className="min-h-screen bg-[#0b0f17] text-white flex items-center justify-center">
        <div className="flex items-center gap-2 text-white/70">
          <Loader2 className="w-4 h-4 animate-spin" />
          Validando admin...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f17] text-white [color-scheme:dark]">
      <Helmet>
        <title>Painel Administrativo | DoramasPlus</title>
      </Helmet>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-purple-300" />
              <h1 className="text-xl md:text-2xl font-semibold">Painel Administrativo</h1>
            </div>
            <p className="text-sm text-white/60 mt-1">
              Métricas em tempo real da sua base de assinantes DoramasPlus.
            </p>
          </div>

          {/* Tabs (ROTAS) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => goTab("/admin/analytics")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isActiveRoute("/admin/analytics")
                  ? "bg-purple-500/20 border-purple-400/30"
                  : "bg-white/5 border-white/10"
              }`}
            >
              Analytics
            </button>

            <button
              onClick={() => goTab("/admin/doramas")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isActiveRoute("/admin/doramas")
                  ? "bg-purple-500/20 border-purple-400/30"
                  : "bg-white/5 border-white/10"
              }`}
            >
              Doramas
            </button>

            <button
              onClick={() => goTab("/admin/users")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isActiveRoute("/admin/users")
                  ? "bg-purple-500/20 border-purple-400/30"
                  : "bg-white/5 border-white/10"
              }`}
            >
              Usuários
            </button>

            {/* ✅ NOVA ABA: SUPORTE (AdminSupport) */}
            <button
              onClick={() => goTab("/admin/support")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isActiveRoute("/admin/support")
                  ? "bg-purple-500/20 border-purple-400/30"
                  : "bg-white/5 border-white/10"
              }`}
            >
              Suporte
            </button>

            {/* ✅ NOVA ABA: BOT DE VENDAS (AdminBotVendas) */}
            <button
              onClick={() => goTab("/admin/bot-vendas")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                isActiveRoute("/admin/bot-vendas")
                  ? "bg-purple-500/20 border-purple-400/30"
                  : "bg-white/5 border-white/10"
              }`}
            >
              Bot Vendas
            </button>
          </div>
        </div>

        {/* Assistindo ao vivo agora */}
        <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5 flex items-center gap-5">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <div className="text-4xl font-bold tabular-nums">
            {viewersNow === null ? (
              <Loader2 className="w-6 h-6 animate-spin text-white/40" />
            ) : (
              viewersNow
            )}
          </div>
          <div className="text-sm text-white/60">assistindo agora</div>
        </div>

        {/* Filtro */}
        <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-white/80">
            <Calendar className="w-4 h-4" />
            Filtro de período
          </div>
          <div className="text-xs text-white/50 mt-1">{periodLabel}</div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="text-xs text-white/60">Período rápido</label>
              <select
                value={quickPeriod}
                onChange={(e) => setQuickPeriod(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none text-white"
                style={{ colorScheme: "dark" }}
              >
                <option value="this_month">Este mês</option>
                <option value="last_month">Mês passado</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="text-xs text-white/60">Data inicial</label>
              <input
                type="date"
                value={startDateStr}
                onChange={(e) => {
                  setQuickPeriod("custom");
                  setStartDateStr(e.target.value);
                }}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none text-white"
                style={{ colorScheme: "dark" }}
              />
            </div>

            <div className="md:col-span-3">
              <label className="text-xs text-white/60">Data final</label>
              <input
                type="date"
                value={endDateStr}
                onChange={(e) => {
                  setQuickPeriod("custom");
                  setEndDateStr(e.target.value);
                }}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none text-white"
                style={{ colorScheme: "dark" }}
              />
            </div>

            <div className="md:col-span-2 flex gap-2">
              <button
                onClick={fetchAllMetrics}
                className="w-full rounded-lg bg-purple-500/20 border border-purple-400/30 px-3 py-2 text-sm hover:bg-purple-500/25 transition"
              >
                Atualizar
              </button>
            </div>
          </div>
        </div>

        {/* Comparar com (churn/retenção) */}
        <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-white/80">
            <TrendingDown className="w-4 h-4" />
            Comparar com (churn/retenção)
          </div>
          <div className="text-xs text-white/50 mt-1">Comparação: {compareLabel}</div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="text-xs text-white/60">Período de comparação</label>
              <select
                value={comparePeriod}
                onChange={(e) => setComparePeriod(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none text-white"
                style={{ colorScheme: "dark" }}
              >
                <option value="prev_month">Mês anterior ao período selecionado</option>
                <option value="custom">Personalizado</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="text-xs text-white/60">Data inicial</label>
              <input
                type="date"
                value={compareStartDateStr}
                onChange={(e) => {
                  setComparePeriod("custom");
                  setCompareStartDateStr(e.target.value);
                }}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none text-white"
                style={{ colorScheme: "dark" }}
              />
            </div>

            <div className="md:col-span-3">
              <label className="text-xs text-white/60">Data final</label>
              <input
                type="date"
                value={compareEndDateStr}
                onChange={(e) => {
                  setComparePeriod("custom");
                  setCompareEndDateStr(e.target.value);
                }}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none text-white"
                style={{ colorScheme: "dark" }}
              />
            </div>
          </div>
        </div>

        {/* Estado: erro / warning / loading */}
        {error ? (
          <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-200">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4" />
              Erro
            </div>
            <div className="mt-1 text-red-200/90 break-words">{error}</div>
          </div>
        ) : null}

        {!error && warning ? (
          <div className="mt-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 p-4 text-sm text-yellow-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4" />
              Aviso
            </div>
            <div className="mt-1 text-yellow-100/90 break-words">{warning}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-white/70">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando métricas...
          </div>
        ) : null}

        {/* Conteúdo */}
        {!loading && !error ? (
          <>
            {/* Linha 1 */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-3">
                {renderCard(
                  "Ativos agora",
                  `${metrics.active_now}`,
                  <Users className="w-5 h-5 text-green-300" />,
                  `Mensal: ${metrics.active_now_monthly} • Trimestral: ${metrics.active_now_quarterly}`,
                  "ok"
                )}
              </div>

              <div className="md:col-span-3">
                {renderCard(
                  "Pendentes agora",
                  `${metrics.pending_now}`,
                  <Clock className="w-5 h-5 text-yellow-300" />,
                  "Pix pendente (agora)",
                  "warn"
                )}
              </div>

              <div className="md:col-span-3">
                {renderCard(
                  "Faturamento (período)",
                  formatBRL(revenuePeriod),
                  <CreditCard className="w-5 h-5 text-blue-300" />,
                  "Aproximação: soma das vendas no período"
                )}
              </div>

              <div className="md:col-span-3">
                {renderCard(
                  "MRR (total)",
                  formatBRL(mrrTotal),
                  <BarChart3 className="w-5 h-5 text-purple-300" />,
                  "Mensal + (Trimestral ÷ 3)"
                )}
              </div>
            </div>

            {/* Linha 2 (MRR mensal/trimestral) */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-6">
                {renderCard(
                  "MRR Mensal",
                  formatBRL(mrrMonthly),
                  <CreditCard className="w-5 h-5 text-white/70" />,
                  `${metrics.active_now_monthly} assinaturas`
                )}
              </div>
              <div className="md:col-span-6">
                {renderCard(
                  "MRR Trimestral (÷ 3)",
                  formatBRL(mrrQuarterly),
                  <CreditCard className="w-5 h-5 text-yellow-300" />,
                  `${metrics.active_now_quarterly} assinaturas`
                )}
              </div>
            </div>

            {/* Retenção D30 (VIEW) */}
            <div className="mt-6">
              <div className="text-sm font-semibold text-white/80 mb-2">Retenção (30 dias)</div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  {renderCard(
                    "Base com 30 dias",
                    `${retD30.base_com_30_dias}`,
                    <Users className="w-5 h-5 text-white/70" />,
                    "Pagaram entre 60 e 30 dias atrás"
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Ainda ativos",
                    `${retD30.ainda_ativos}`,
                    <CheckIcon />,
                    "Pagaram novamente nos últimos 30 dias",
                    "ok"
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Retenção D30",
                    formatPct(retD30.retencao_d30),
                    <TrendingUp className="w-5 h-5 text-green-300" />,
                    "via edge function admin-analytics",
                    "ok"
                  )}
                </div>
              </div>

              <div className="mt-2 text-xs text-white/45">{retentionWindowLabel}</div>
            </div>

            {/* Churn / Retenção (período selecionado vs. comparação) */}
            <div className="mt-6">
              <div className="text-sm font-semibold text-white/80 mb-2">Churn / Retenção (período selecionado)</div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-3">
                  {renderCard(
                    "Entraram no período",
                    `${churn.period.new}`,
                    <UserPlus className="w-5 h-5 text-green-300" />,
                    "Primeira assinatura no período",
                    "ok"
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Saíram no período",
                    `${churn.period.churned}`,
                    <UserMinus className="w-5 h-5 text-red-300" />,
                    `De ${churn.period.cohort} ativos no início do período`,
                    churn.period.churned > 0 ? "bad" : "default"
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retidos no período",
                    `${churn.period.retained}`,
                    <Users className="w-5 h-5 text-white/70" />,
                    `De ${churn.period.cohort} ativos no início do período`
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retenção do período",
                    formatPct(churn.period.retention_rate),
                    <TrendingUp className="w-5 h-5 text-green-300" />,
                    "Retidos ÷ ativos no início",
                    "ok"
                  )}
                </div>
              </div>

              <div className="mt-4 text-xs text-white/50">Comparação — {compareLabel}</div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-3">
                  {renderCard(
                    "Entraram (comparação)",
                    `${churn.compare_period.new}`,
                    <UserPlus className="w-5 h-5 text-white/50" />,
                    "Primeira assinatura no período comparado"
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Saíram (comparação)",
                    `${churn.compare_period.churned}`,
                    <UserMinus className="w-5 h-5 text-white/50" />,
                    `De ${churn.compare_period.cohort} ativos no início`
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retidos (comparação)",
                    `${churn.compare_period.retained}`,
                    <Users className="w-5 h-5 text-white/50" />,
                    `De ${churn.compare_period.cohort} ativos no início`
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retenção (comparação)",
                    formatPct(churn.compare_period.retention_rate),
                    churn.period.retention_rate >= churn.compare_period.retention_rate ? (
                      <TrendingUp className="w-5 h-5 text-green-300" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-300" />
                    ),
                    churn.period.retention_rate >= churn.compare_period.retention_rate
                      ? "Retenção do período está melhor"
                      : "Retenção do período está pior",
                    churn.period.retention_rate >= churn.compare_period.retention_rate ? "ok" : "bad"
                  )}
                </div>
              </div>

              <div className="mt-2 text-xs text-white/45">
                "Ativo no início" = cobertura reconstruída a partir do histórico de renovações. "Retido" = a
                assinatura atual do usuário ainda cobre o fim do período em questão (mesma regra do gate de acesso).
              </div>
            </div>

            {/* Vendas (período selecionado) */}
            <div className="mt-6">
              <div className="text-sm font-semibold text-white/80 mb-2">Vendas (período selecionado)</div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  {renderCard(
                    "Vendas (total)",
                    `${metrics.sold_total}`,
                    <Users className="w-5 h-5 text-green-300" />,
                    `Mensal: ${metrics.sold_monthly} • Trimestral: ${metrics.sold_quarterly}`,
                    "ok"
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Vendas (mensal)",
                    `${metrics.sold_monthly}`,
                    <CreditCard className="w-5 h-5 text-white/70" />,
                    `Preço: ${formatBRL(PRICE_MONTHLY)}`
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Vendas (trimestral)",
                    `${metrics.sold_quarterly}`,
                    <CreditCard className="w-5 h-5 text-yellow-300" />,
                    `Preço: ${formatBRL(PRICE_QUARTERLY)}`
                  )}
                </div>
              </div>
            </div>

            {/* Insights rápidos */}
            <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="text-sm font-semibold text-white/80 mb-2">Insights rápidos</div>
              <div className="text-sm text-white/70 space-y-1">
                <div>• Ticket médio (aprox.) por assinante ativo: {formatBRL(avgTicket)}</div>
                <div>• Assinaturas ativas neste momento: {metrics.active_now}</div>
                <div>• Pendentes agora (pix): {metrics.pending_now}</div>
                <div>• Pendentes no período (pix): {metrics.pending_in_period}</div>
                <div>
                  • Retenção 30 dias (D30): {formatPct(retD30.retencao_d30)} (base: {retD30.base_com_30_dias} • ativos:{" "}
                  {retD30.ainda_ativos})
                </div>
              </div>

              <div className="mt-3 text-xs text-white/45">
                Obs: subscriptions consultado direto (RLS permite admin); pix_payments via edge function admin-analytics (service_role, sem restrição de RLS).
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Ícone simples (pra não importar mais coisa) */
function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-green-300" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
