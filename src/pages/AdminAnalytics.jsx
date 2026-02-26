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
  return new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
}
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
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

  // Filtro de período
  const [quickPeriod, setQuickPeriod] = useState("this_month"); // this_month | last_month | custom
  const [startDateStr, setStartDateStr] = useState("");
  const [endDateStr, setEndDateStr] = useState("");

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

  // Retenção D30 (VIEW: admin_retencao_d30)
  const [retD30, setRetD30] = useState({
    base_com_30_dias: 0,
    ainda_ativos: 0,
    retencao_d30: 0,
  });

  // ✅ Retenção múltiplos cortes (VIEW: admin_retencao_multiplos_cortes)
  const [retMulti, setRetMulti] = useState([]); // array de linhas
  const [retMultiWarning, setRetMultiWarning] = useState("");

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
        // fallback (este mês)
        const s2 = startOfMonth(now);
        const e2 = endOfMonth(now);
        return {
          periodStart: s2,
          periodEnd: e2,
          periodLabel: `Período: ${toDateInputValue(s2).split("-").reverse().join("/")} até ${toDateInputValue(e2)
            .split("-")
            .reverse()
            .join("/")}`,
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

    // this_month (default)
    const s = startOfMonth(now);
    const e = endOfMonth(now);
    return {
      periodStart: s,
      periodEnd: e,
      periodLabel: `Período: ${toDateInputValue(s).split("-").reverse().join("/")} até ${toDateInputValue(e)
        .split("-")
        .reverse()
        .join("/")}`,
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
    // Só busca se for admin confirmado
    if (!adminChecked || !isAdmin) return;

    setLoading(true);
    setError("");
    setWarning("");
    setRetMultiWarning("");

    try {
      // ✅ 1) RPC (periodizado) — fonte principal dos cards do período
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_metrics_period", {
        p_start: toISO(periodStart),
        p_end: toISO(periodEnd),
        price_monthly: PRICE_MONTHLY,
        price_quarterly: PRICE_QUARTERLY,
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || "Erro ao rodar admin_metrics_period");
      }

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;

      setMetrics({
        active_now: safeNum(row?.active_now),
        active_now_monthly: safeNum(row?.active_now_monthly),
        active_now_quarterly: safeNum(row?.active_now_quarterly),

        pending_now: safeNum(row?.pending_now),
        pending_in_period: safeNum(row?.pending_in_period),

        sold_total: safeNum(row?.sold_total),
        sold_monthly: safeNum(row?.sold_monthly),
        sold_quarterly: safeNum(row?.sold_quarterly),

        revenue_estimated_in_period: safeNum(row?.revenue_estimated_in_period),

        mrr_total_estimated: safeNum(row?.mrr_total_estimated),
        mrr_monthly_estimated: safeNum(row?.mrr_monthly_estimated),
        mrr_quarterly_estimated: safeNum(row?.mrr_quarterly_estimated),
      });

      // ✅ 2) Retenção D30 (VIEW) — NÃO depende do filtro do período
      // ✅ FIX DEFINITIVO: busca '*' pra não quebrar quando você renomear coluna na VIEW.
      const { data: d30Data, error: d30Err } = await supabase
        .from("admin_retencao_d30")
        .select("*")
        .maybeSingle();

      if (d30Err) {
        console.warn("admin_retencao_d30 error:", d30Err);
        setWarning(`Aviso (Retenção D30): ${d30Err.message || "sem acesso à VIEW"}`);
        setRetD30({ base_com_30_dias: 0, ainda_ativos: 0, retencao_d30: 0 });
      } else {
        const rawRet =
          d30Data?.retencao_d30 ??
          d30Data?.retencao_d30_pct ??
          d30Data?.retencao_d30_percent ??
          d30Data?.retencao_d30_porcentagem ??
          0;

        setRetD30({
          base_com_30_dias: safeNum(d30Data?.base_com_30_dias),
          ainda_ativos: safeNum(d30Data?.ainda_ativos),
          retencao_d30: safeNum(rawRet),
        });
      }

      // ✅ 3) Retenção múltiplos cortes (VIEW) — 30/45/60/90/120 (ou o que existir na view)
      const { data: multiData, error: multiErr } = await supabase
        .from("admin_retencao_multiplos_cortes")
        .select("*")
        .order("dias_corte", { ascending: true });

      if (multiErr) {
        console.warn("admin_retencao_multiplos_cortes error:", multiErr);
        setRetMultiWarning(`Aviso (Retenção múltiplos cortes): ${multiErr.message || "sem acesso à VIEW"}`);
        setRetMulti([]);
      } else {
        setRetMulti(Array.isArray(multiData) ? multiData : []);
      }
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  }, [adminChecked, isAdmin, periodStart, periodEnd]);

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
          </div>
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

        {!error && retMultiWarning ? (
          <div className="mt-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 p-4 text-sm text-yellow-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4" />
              Aviso
            </div>
            <div className="mt-1 text-yellow-100/90 break-words">{retMultiWarning}</div>
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
                    "Quem já poderia ter renovado (coorte)"
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Ainda ativos",
                    `${retD30.ainda_ativos}`,
                    <CheckIcon />,
                    "Dessa base, quem continua ativo",
                    "ok"
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Retenção D30",
                    formatPct(retD30.retencao_d30),
                    <TrendingUp className="w-5 h-5 text-green-300" />,
                    "VIEW: admin_retencao_d30",
                    "ok"
                  )}
                </div>
              </div>

              <div className="mt-2 text-xs text-white/45">{retentionWindowLabel}</div>
            </div>

            {/* ✅ Retenção múltiplos cortes (VIEW) */}
            <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-white/80">Retenção por cortes (30 / 45 / 60 / 90 / 120)</div>
                  <div className="text-xs text-white/45 mt-1">
                    VIEW: <span className="text-white/60">admin_retencao_multiplos_cortes</span> (vai preenchendo conforme o tempo passa)
                  </div>
                </div>

                <button
                  onClick={fetchAllMetrics}
                  className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm hover:bg-white/10 transition"
                >
                  Recarregar
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-left border-b border-white/10 text-white/70">
                      <th className="py-2 pr-4">Dias</th>
                      <th className="py-2 pr-4">Base</th>
                      <th className="py-2 pr-4">Ainda ativos</th>
                      <th className="py-2 pr-4">Retenção</th>
                      <th className="py-2 pr-4">Base mensal</th>
                      <th className="py-2 pr-4">Ativos mensal</th>
                      <th className="py-2 pr-4">Base trimestral</th>
                      <th className="py-2 pr-0">Ativos trimestral</th>
                    </tr>
                  </thead>

                  <tbody>
                    {retMulti?.length ? (
                      retMulti.map((r) => {
                        const dias = safeNum(r?.dias_corte);
                        const baseTotal = safeNum(r?.base_total);
                        const aindaAtivos = safeNum(r?.ainda_ativos);
                        const retPct = r?.retencao_pct;

                        const baseMensal = safeNum(r?.base_mensal);
                        const aindaMensal = safeNum(r?.ainda_mensal);
                        const baseTri = safeNum(r?.base_trimestr);
                        const aindaTri = safeNum(r?.ainda_trimestr);

                        return (
                          <tr key={dias} className="border-b border-white/5">
                            <td className="py-2 pr-4">{dias}</td>
                            <td className="py-2 pr-4">{baseTotal}</td>
                            <td className="py-2 pr-4">{aindaAtivos}</td>
                            <td className="py-2 pr-4">
                              {retPct === null || retPct === undefined ? "—" : `${safeNum(retPct).toFixed(2)}%`}
                            </td>
                            <td className="py-2 pr-4">{baseMensal}</td>
                            <td className="py-2 pr-4">{aindaMensal}</td>
                            <td className="py-2 pr-4">{baseTri}</td>
                            <td className="py-2 pr-0">{aindaTri}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td className="py-3 text-white/50" colSpan={8}>
                          Sem dados na view (ou sem permissão). Se você acabou de criar, pode levar alguns segundos.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-xs text-white/45">
                Obs: se em 60/90/120 aparecer base 0 e retenção “—”, isso é normal quando ainda não existe gente com esse tempo.
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
                Obs: mantive seu painel como está. Só corrigi o bug do date e adicionei a view de retenção por cortes pra você acompanhar 30/45/60/90/120.
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
