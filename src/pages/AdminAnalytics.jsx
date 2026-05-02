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
    if (!adminChecked || !isAdmin) return;

    setLoading(true);
    setError("");
    setWarning("");

    try {
      const now = new Date();
      const d30ago = new Date(now.getTime() - 30 * 86400000);
      const d60ago = new Date(now.getTime() - 60 * 86400000);

      // ---- 1. Assinaturas ativas (subscriptions) ----
      const [
        { count: cTotal, error: e1 },
        { count: cMonthly, error: e2 },
        { count: cQuarterly, error: e3 },
      ] = await Promise.all([
        supabase.from("subscriptions").select("id", { count: "exact", head: true })
          .eq("status", "active").gt("end_at", now.toISOString()),
        supabase.from("subscriptions").select("id", { count: "exact", head: true })
          .eq("status", "active").gt("end_at", now.toISOString()).ilike("plan_name", "%Padrão%"),
        supabase.from("subscriptions").select("id", { count: "exact", head: true })
          .eq("status", "active").gt("end_at", now.toISOString()).ilike("plan_name", "%Trimestral%"),
      ]);
      if (e1 || e2 || e3) throw new Error((e1 || e2 || e3).message);

      const activeNow = safeNum(cTotal);
      const activeMonthly = safeNum(cMonthly);
      const activeQuarterly = safeNum(cQuarterly);
      const mrrMonthlyVal = activeMonthly * PRICE_MONTHLY;
      const mrrQuarterlyVal = (activeQuarterly * PRICE_QUARTERLY) / 3;
      const mrrTotalVal = mrrMonthlyVal + mrrQuarterlyVal;

      // ---- 2. PIX pendentes ----
      const [
        { count: pendingNow, error: e4 },
        { count: pendingPeriod, error: e5 },
      ] = await Promise.all([
        supabase.from("pix_payments").select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase.from("pix_payments").select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .gte("created_at", toISO(periodStart))
          .lte("created_at", toISO(periodEnd)),
      ]);
      if (e4) setWarning(`Aviso (PIX pendentes): ${e4.message}`);
      if (e5) setWarning(`Aviso (PIX pendentes período): ${e5.message}`);

      // ---- 3. Vendas PIX pagas no período (status = 'paid') ----
      const { data: soldData, error: e6 } = await supabase
        .from("pix_payments")
        .select("amount_cents")
        .eq("status", "paid")
        .gte("created_at", toISO(periodStart))
        .lte("created_at", toISO(periodEnd));
      if (e6) throw new Error(e6.message);

      const midPriceCents = (PRICE_MONTHLY + PRICE_QUARTERLY) / 2 * 100;
      const soldRecords = soldData || [];
      const soldTotal = soldRecords.length;
      const soldMonthly = soldRecords.filter(r => safeNum(r.amount_cents) < midPriceCents).length;
      const soldQuarterly = soldRecords.filter(r => safeNum(r.amount_cents) >= midPriceCents).length;
      const revenuePeriod = soldRecords.reduce((s, r) => s + safeNum(r.amount_cents), 0) / 100;

      setMetrics({
        active_now: activeNow,
        active_now_monthly: activeMonthly,
        active_now_quarterly: activeQuarterly,
        pending_now: safeNum(pendingNow),
        pending_in_period: safeNum(pendingPeriod),
        sold_total: soldTotal,
        sold_monthly: soldMonthly,
        sold_quarterly: soldQuarterly,
        revenue_estimated_in_period: revenuePeriod,
        mrr_total_estimated: mrrTotalVal,
        mrr_monthly_estimated: mrrMonthlyVal,
        mrr_quarterly_estimated: mrrQuarterlyVal,
      });

      // ---- 4. Retenção D30 (direto do banco, status = 'paid') ----
      // Base: usuários que pagaram entre 60 e 30 dias atrás
      const { data: baseData, error: e7 } = await supabase
        .from("pix_payments")
        .select("user_id")
        .eq("status", "paid")
        .gte("created_at", d60ago.toISOString())
        .lt("created_at", d30ago.toISOString());

      if (e7) {
        setWarning(`Aviso (Retenção D30): ${e7.message}`);
        setRetD30({ base_com_30_dias: 0, ainda_ativos: 0, retencao_d30: 0 });
      } else {
        const baseIds = [...new Set((baseData || []).map(r => r.user_id))];
        const d30Base = baseIds.length;
        let d30Retained = 0;

        if (d30Base > 0) {
          // Retidos: dos que estavam na base, quem pagou novamente nos últimos 30 dias
          const { data: retData } = await supabase
            .from("pix_payments")
            .select("user_id")
            .eq("status", "paid")
            .gte("created_at", d30ago.toISOString())
            .in("user_id", baseIds);
          d30Retained = new Set((retData || []).map(r => r.user_id)).size;
        }

        setRetD30({
          base_com_30_dias: d30Base,
          ainda_ativos: d30Retained,
          retencao_d30: d30Base > 0 ? (d30Retained / d30Base) * 100 : 0,
        });
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
                    "pix_payments, status='paid'",
                    "ok"
                  )}
                </div>
              </div>

              <div className="mt-2 text-xs text-white/45">{retentionWindowLabel}</div>
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
                Obs: todos os dados vêm de queries diretas — subscriptions para ativos/MRR, pix_payments (status='paid') para vendas/receita/retenção.
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
