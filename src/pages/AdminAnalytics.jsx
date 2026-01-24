// src/pages/AdminAnalytics.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Helmet } from "react-helmet";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import {
  BarChart3,
  Users,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Calendar,
} from "lucide-react";

/**
 * ✅ AJUSTE OS PREÇOS AQUI (em reais)
 * - Mensal: DoramaPlay Padrão
 * - Trimestral: DoramaPlay Trimestral
 */
const PRICE_MONTHLY = 15.9;
const PRICE_QUARTERLY = 43.9;

/**
 * ✅ Nomes "prováveis" de plano (baseado no que você mostrou do seu banco)
 * Se o seu `subscriptions.plan_name` tiver outros nomes, ajuste aqui.
 */
const MONTHLY_MATCH = ["mensal", "padrão", "padrao", "monthly"];
const QUARTERLY_MATCH = ["trimestral", "quarterly", "trimestre"];

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
function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function addMonths(d, months) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
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
function includesAny(haystack, needles) {
  const h = String(haystack || "").toLowerCase();
  return needles.some((n) => h.includes(String(n).toLowerCase()));
}

export default function AdminAnalytics() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("analytics"); // analytics | doramas | usuarios

  // Filtro de período
  const [quickPeriod, setQuickPeriod] = useState("this_month"); // this_month | last_month | custom
  const [startDateStr, setStartDateStr] = useState("");
  const [endDateStr, setEndDateStr] = useState("");

  // Estado de carregamento / erro
  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [error, setError] = useState("");

  // Métricas (SQL dos deuses + complementos)
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

  // Complementos (porque o painel precisa de breakdown e cards do jeito certo)
  const [activeBreakdown, setActiveBreakdown] = useState({
    active_total: 0,
    active_monthly: 0,
    active_quarterly: 0,
  });

  const [periodBreakdown, setPeriodBreakdown] = useState({
    due_period_total: 0, // vencem no período (start..end)
    due_period_past: 0, // já venceram dentro do período (end_at < now)
    due_period_future: 0, // ainda vão vencer dentro do período (end_at >= now)
    churned_in_period: 0, // desistiram no período
    pending_in_period: 0, // pagamentos pendentes (pix) no período
    expires_in_period: 0, // expiradas (aprox) no período
  });

  // Lista de usuários por status (opcional)
  const [usersList, setUsersList] = useState([]);

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
    // custom não mexe (deixa o usuário digitar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickPeriod]);

  // Gate admin
  useEffect(() => {
    let mounted = true;

    const checkAdmin = async () => {
      try {
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
          // se der erro, não derruba: só mostra erro e deixa você ver
          console.warn("profiles check error:", profErr);
          return;
        }

        if (prof && prof.is_admin === false) {
          navigate("/");
          return;
        }
      } catch (e) {
        console.warn("admin gate error:", e);
      } finally {
        if (mounted) {
          // ok
        }
      }
    };

    checkAdmin();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const fetchAllMetrics = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      // 1) SQL dos deuses (RPC)
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_metrics_period", {
        p_start: toISO(periodStart),
        p_end: toISO(periodEnd),
      });

      if (rpcErr) {
        throw new Error(rpcErr.message || "Erro ao rodar admin_metrics_period");
      }

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const base = {
        active_now: safeNum(row?.active_now),
        due_in_period: safeNum(row?.due_in_period),
        due_future: safeNum(row?.due_future),
        due_past: safeNum(row?.due_past),
        churned: safeNum(row?.churned),
        renewed_estimated: safeNum(row?.renewed_estimated),
        sold_monthly: safeNum(row?.sold_monthly),
        sold_quarterly: safeNum(row?.sold_quarterly),
      };
      setMetrics(base);

      // 2) Breakdown de ativos agora (mensal vs trimestral)
      //    (precisa do plan_name, pq o RPC não traz isso)
      const nowIso = new Date().toISOString();
      const { data: activeSubs, error: activeSubsErr } = await supabase
        .from("subscriptions")
        .select("id, plan_name, status, end_at")
        .eq("status", "active")
        .gt("end_at", nowIso);

      if (activeSubsErr) {
        console.warn("active subscriptions error:", activeSubsErr);
      }

      const list = Array.isArray(activeSubs) ? activeSubs : [];
      let monthly = 0;
      let quarterly = 0;

      for (const s of list) {
        const planName = s?.plan_name || "";
        if (includesAny(planName, QUARTERLY_MATCH)) quarterly += 1;
        else if (includesAny(planName, MONTHLY_MATCH)) monthly += 1;
        else {
          // fallback: se não reconheceu, assume mensal (pra não zerar seu MRR)
          monthly += 1;
        }
      }

      setActiveBreakdown({
        active_total: list.length,
        active_monthly: monthly,
        active_quarterly: quarterly,
      });

      // 3) Cards do período que fazem sentido pra você:
      //    - vencem no período (start..end)
      //    - já venceram (dentro do período, end_at < agora)
      //    - ainda vão vencer (dentro do período, end_at >= agora)
      //    - desistiram no período (status != active e end_at dentro do período) [aprox]
      const now = new Date();
      const nowISO = now.toISOString();

      // 3a) Já venceram no período
      const { count: duePastInPeriod, error: duePastInPeriodErr } = await supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .gte("end_at", toISO(periodStart))
        .lte("end_at", toISO(periodEnd))
        .lt("end_at", nowISO);

      if (duePastInPeriodErr) console.warn("duePastInPeriod error:", duePastInPeriodErr);

      // 3b) Ainda vão vencer no período
      const { count: dueFutureInPeriod, error: dueFutureInPeriodErr } = await supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .gte("end_at", toISO(periodStart))
        .lte("end_at", toISO(periodEnd))
        .gte("end_at", nowISO);

      if (dueFutureInPeriodErr) console.warn("dueFutureInPeriod error:", dueFutureInPeriodErr);

      // 3c) Desistiram no período (aproximação: status != active e end_at dentro do período)
      const { count: churnedInPeriod, error: churnedInPeriodErr } = await supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .neq("status", "active")
        .gte("end_at", toISO(periodStart))
        .lte("end_at", toISO(periodEnd));

      if (churnedInPeriodErr) console.warn("churnedInPeriod error:", churnedInPeriodErr);

      // 3d) Pagamentos pendentes no período (pix)
      const { count: pendingInPeriod, error: pendingInPeriodErr } = await supabase
        .from("pix_payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .gte("created_at", toISO(periodStart))
        .lte("created_at", toISO(periodEnd));

      if (pendingInPeriodErr) console.warn("pendingInPeriod error:", pendingInPeriodErr);

      // 3e) Expiradas no período (status != active + end_at dentro do período) (igual churnedInPeriod, mas separado pra card)
      const expires = safeNum(churnedInPeriod);

      setPeriodBreakdown({
        due_period_total: safeNum(base.due_in_period),
        due_period_past: safeNum(duePastInPeriod),
        due_period_future: safeNum(dueFutureInPeriod),
        churned_in_period: safeNum(churnedInPeriod),
        pending_in_period: safeNum(pendingInPeriod),
        expires_in_period: safeNum(expires),
      });

      // 4) Lista de usuários (opcional, só pra aba Usuários)
      //    - aqui eu busco pouca coisa pra não pesar
      //    - se você quiser uma lista mais completa depois, a gente ajusta
      setUsersList([]);
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  }, [periodStart, periodEnd]);

  useEffect(() => {
    fetchAllMetrics();
  }, [fetchAllMetrics]);

  // Receita / MRR
  const mrrMonthly = useMemo(() => activeBreakdown.active_monthly * PRICE_MONTHLY, [activeBreakdown.active_monthly]);
  const mrrQuarterly = useMemo(
    () => activeBreakdown.active_quarterly * (PRICE_QUARTERLY / 3),
    [activeBreakdown.active_quarterly]
  );
  const mrrTotal = useMemo(() => mrrMonthly + mrrQuarterly, [mrrMonthly, mrrQuarterly]);

  // Faturamento no período (aprox por vendas)
  const revenuePeriod = useMemo(() => {
    return metrics.sold_monthly * PRICE_MONTHLY + metrics.sold_quarterly * PRICE_QUARTERLY;
  }, [metrics.sold_monthly, metrics.sold_quarterly]);

  // Churn/Retenção do período (baseado em vencimentos do período)
  const churnPeriodPct = useMemo(() => {
    const denom = safeNum(periodBreakdown.due_period_total);
    if (!denom) return 0;
    return (safeNum(periodBreakdown.churned_in_period) / denom) * 100;
  }, [periodBreakdown.due_period_total, periodBreakdown.churned_in_period]);

  const retentionPct = useMemo(() => {
    const v = 100 - churnPeriodPct;
    return v < 0 ? 0 : v;
  }, [churnPeriodPct]);

  // Ticket médio (aprox) por assinante ativo (MRR total / ativos agora)
  const avgTicket = useMemo(() => {
    const denom = safeNum(activeBreakdown.active_total);
    if (!denom) return 0;
    return mrrTotal / denom;
  }, [activeBreakdown.active_total, mrrTotal]);

  // UI
  const onChangeQuick = (v) => {
    setQuickPeriod(v);
    if (v !== "custom") {
      // inputs são atualizados pelo effect
    }
  };

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

  return (
    <div className="min-h-screen bg-[#0b0f17] text-white">
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

          {/* Tabs */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("analytics")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                activeTab === "analytics" ? "bg-purple-500/20 border-purple-400/30" : "bg-white/5 border-white/10"
              }`}
            >
              Analytics
            </button>
            <button
              onClick={() => setActiveTab("doramas")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                activeTab === "doramas" ? "bg-purple-500/20 border-purple-400/30" : "bg-white/5 border-white/10"
              }`}
            >
              Doramas
            </button>
            <button
              onClick={() => setActiveTab("usuarios")}
              className={`px-3 py-2 rounded-lg text-sm border ${
                activeTab === "usuarios" ? "bg-purple-500/20 border-purple-400/30" : "bg-white/5 border-white/10"
              }`}
            >
              Usuários
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
                onChange={(e) => onChangeQuick(e.target.value)}
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none"
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
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none"
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
                className="mt-1 w-full rounded-lg bg-[#0b0f17] border border-white/15 px-3 py-2 text-sm outline-none"
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

        {/* Estado: erro / loading */}
        {error ? (
          <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-200">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4" />
              Erro
            </div>
            <div className="mt-1 text-red-200/90 break-words">{error}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-white/70">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando métricas...
          </div>
        ) : null}

        {/* Conteúdo por aba */}
        {activeTab === "analytics" && !loading ? (
          <>
            {/* Linha 1 */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-3">
                {renderCard(
                  "Ativos agora",
                  `${activeBreakdown.active_total}`,
                  <Users className="w-5 h-5 text-green-300" />,
                  `Mensal: ${activeBreakdown.active_monthly} • Trimestral: ${activeBreakdown.active_quarterly}`,
                  "ok"
                )}
              </div>

              <div className="md:col-span-3">
                {renderCard(
                  "Pendentes agora",
                  `${periodBreakdown.pending_in_period}`,
                  <Clock className="w-5 h-5 text-yellow-300" />,
                  "Podem virar receita",
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
                  `${activeBreakdown.active_monthly} assinaturas`
                )}
              </div>
              <div className="md:col-span-6">
                {renderCard(
                  "MRR Trimestral (÷ 3)",
                  formatBRL(mrrQuarterly),
                  <CreditCard className="w-5 h-5 text-yellow-300" />,
                  `${activeBreakdown.active_quarterly} assinaturas`
                )}
              </div>
            </div>

            {/* Linha 3 (vencimentos do período - do jeito que faz sentido) */}
            <div className="mt-6">
              <div className="text-sm font-semibold text-white/80 mb-2">
                Meu período selecionado (renovação)
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-3">
                  {renderCard(
                    "Vencem no período",
                    `${periodBreakdown.due_period_total}`,
                    <Clock className="w-5 h-5 text-white/70" />,
                    '"Boletos" do período'
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Ainda vão vencer",
                    `${periodBreakdown.due_period_future}`,
                    <Clock className="w-5 h-5 text-yellow-300" />,
                    "End_at ≥ hoje",
                    "warn"
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Já venceram",
                    `${periodBreakdown.due_period_past}`,
                    <Clock className="w-5 h-5 text-blue-300" />,
                    "End_at < hoje"
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Desistiram",
                    `${periodBreakdown.churned_in_period}`,
                    <AlertCircle className="w-5 h-5 text-red-300" />,
                    "Status != active",
                    "bad"
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-3">
                  {renderCard(
                    "Renovaram (estimado)",
                    `${metrics.renewed_estimated}`,
                    <CheckCircle2 className="w-5 h-5 text-green-300" />,
                    "Estimativa (aprox.)",
                    "ok"
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Trimestral vendido",
                    `${metrics.sold_quarterly}`,
                    <CreditCard className="w-5 h-5 text-yellow-300" />,
                    `Mensal vendido: ${metrics.sold_monthly}`
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retenção (período)",
                    formatPct(retentionPct),
                    <BarChart3 className="w-5 h-5 text-green-300" />,
                    "100% - churn"
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Churn (período)",
                    formatPct(churnPeriodPct),
                    <AlertCircle className="w-5 h-5 text-red-300" />,
                    `Perdeu: ${periodBreakdown.churned_in_period}`,
                    "bad"
                  )}
                </div>
              </div>

              {/* Insights rápidos */}
              <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-4">
                <div className="text-sm font-semibold text-white/80 mb-2">Insights rápidos</div>
                <div className="text-sm text-white/70 space-y-1">
                  <div>• Ticket médio (aprox.) por assinante ativo: {formatBRL(avgTicket)}</div>
                  <div>• Assinaturas ativas neste momento: {activeBreakdown.active_total}</div>
                  <div>• Pendentes que podem virar receita (no período): {periodBreakdown.pending_in_period}</div>
                  <div>
                    • Vencimentos no período: {periodBreakdown.due_period_total} (já venceram:{" "}
                    {periodBreakdown.due_period_past}, ainda vão vencer: {periodBreakdown.due_period_future})
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "doramas" ? (
          <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-5 text-white/70">
            Aqui a gente pode colocar métricas de catálogo / uploads / views depois.
          </div>
        ) : null}

        {activeTab === "usuarios" ? (
          <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white/80">Usuários por status (preview)</div>
              <button
                onClick={async () => {
                  setLoadingUsers(true);
                  setError("");
                  try {
                    // Lista pequena pra não travar: 50 mais recentes
                    const { data, error: uErr } = await supabase
                      .from("profiles")
                      .select("email, created_at, active")
                      .order("created_at", { ascending: false })
                      .limit(50);

                    if (uErr) throw new Error(uErr.message || "Erro ao buscar usuários");
                    setUsersList(Array.isArray(data) ? data : []);
                  } catch (e) {
                    setError(String(e?.message || e || "Erro desconhecido"));
                  } finally {
                    setLoadingUsers(false);
                  }
                }}
                className="px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 hover:bg-white/10 transition"
              >
                {loadingUsers ? "Carregando..." : "Carregar"}
              </button>
            </div>

            <div className="mt-4 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/60 border-b border-white/10">
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Criado em</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {usersList.length === 0 ? (
                    <tr>
                      <td className="py-3 text-white/50" colSpan={3}>
                        Clique em “Carregar” para listar (últimos 50).
                      </td>
                    </tr>
                  ) : (
                    usersList.map((u, idx) => (
                      <tr key={`${u.email}-${idx}`} className="border-b border-white/5">
                        <td className="py-2 pr-3 text-white/80">{u.email}</td>
                        <td className="py-2 pr-3 text-white/60">
                          {u.created_at ? new Date(u.created_at).toLocaleString("pt-BR") : "-"}
                        </td>
                        <td className="py-2 pr-3">
                          {u.active ? (
                            <span className="text-green-300">Ativo</span>
                          ) : (
                            <span className="text-red-300">Inativo</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
