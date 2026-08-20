// src/pages/AdminAnalytics.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import AdminTabs from "@/components/AdminTabs";
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
  HelpCircle,
} from "lucide-react";

/**
 * ✅ AJUSTE OS PREÇOS AQUI (em reais)
 * - Mensal: DoramaPlay Padrão
 * - Trimestral: DoramaPlay Trimestral
 */
// ✅ 19/08 fix: tava 15,90/43,90 desde sempre — preço vigente é 17,90/49,90
// (mensal desde 27/07). O MRR agora vem CALCULADO da edge function (fonte
// única, separando os ~300 legados do Stripe que ainda pagam preço antigo);
// estas constantes ficam só de rótulo/fallback.
const PRICE_MONTHLY = 17.9;
const PRICE_QUARTERLY = 49.9;

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
// ✅ 01/08 fix: setMonth() sozinho estoura o dia quando o mês de destino é
// mais curto (ex.: 31/07 - 1 mês = "31 de junho", que não existe, e o JS
// rolava sozinho pra 01/07 — fazia "Mês passado" virar o mês ATUAL de novo
// nos dias 29/30/31). Agora trava (clamp) no último dia do mês de destino.
function addMonths(d, months) {
  const targetIndex = d.getMonth() + months;
  const year = d.getFullYear() + Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const lastDayOfTarget = new Date(year, month + 1, 0).getDate();
  const day = Math.min(d.getDate(), lastDayOfTarget);
  const x = new Date(d);
  x.setFullYear(year, month, day);
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
  const [quickPeriod, setQuickPeriod] = useState("today"); // ✅ 20/08 (pedido do Stefano): abre no faturamento DIÁRIO; quer o mês, troca no filtro. today | this_month | last_month | custom
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

  // ✅ 05/08: vendas discriminadas por canal (bot do WhatsApp x site) —
  // antes tudo (infinitepay + asaas, direto ou via bot) caía junto em
  // sold_monthly/sold_quarterly, sem dar pra saber quanto veio de cada canal.
  const [soldByChannel, setSoldByChannel] = useState({
    bot: { total: 0, mensal: 0, trimestral: 0, revenue_estimated: 0 },
    site: { total: 0, mensal: 0, trimestral: 0, revenue_estimated: 0 },
  });

  // ✅ 18/08: cadastros novos + conversão (mesma conta do relatório diário
  // por e-mail). Vem da edge function admin-analytics: período do filtro,
  // período de comparação, e sempre hoje/ontem/este mês/mês passado (BRT).
  const emptySignup = { signups: 0, paid: 0, conversion_rate: 0 };
  const [signups, setSignups] = useState({
    period: emptySignup,
    compare: emptySignup,
    today: emptySignup,
    yesterday: emptySignup,
    this_month: emptySignup,
    last_month: emptySignup,
  });

  // "Assinantes fiéis" (estimativa) — sempre "agora", independe do filtro de período
  const [loyal, setLoyal] = useState({
    active_total: 0,
    renewed_once: 0,
    renewed_twice_plus: 0,
  });

  // Composição por faixa de renovações (0, 1, 2, 3...) + % de renovação de
  // referência por faixa (baseada no último mês fechado)
  const [tierComposition, setTierComposition] = useState([]);
  const [tierRetention, setTierRetention] = useState([]);

  // Avulso → assinante (vitalício, não filtra por período) — ver comentário
  // na edge function sobre a limitação de matching por telefone.
  const [avulsoConversion, setAvulsoConversion] = useState({
    pessoas_total: 0,
    com_cadastro: 0,
    ja_assinaram: 0,
    assinaram_depois: 0,
    ativos_agora: 0,
  });

  // Retenção D30
  const [retD30, setRetD30] = useState({
    base_com_30_dias: 0,
    ainda_ativos: 0,
    retencao_d30: 0,
  });

  // Churn / retenção do período (+ período de comparação)
  const [churn, setChurn] = useState({
    period: { new: 0, cohort: 0, retained: 0, churned: 0, retention_rate: 0, winback: 0, winback_rate: 0 },
    compare_period: { new: 0, cohort: 0, retained: 0, churned: 0, retention_rate: 0, winback: 0, winback_rate: 0, period_start: null, period_end: null },
  });


  // Datas derivadas (de acordo com quickPeriod + inputs)
  const { periodStart, periodEnd, periodLabel } = useMemo(() => {
    const now = new Date();

    if (quickPeriod === "today") {
      const s = startOfDay(now);
      const e = endOfDay(now);
      return {
        periodStart: s,
        periodEnd: e,
        periodLabel: `Período: hoje (${toDateInputValue(now).split("-").reverse().join("/")})`,
      };
    }

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

    // this_month (fallback) — vai do dia 1 até HOJE, não até o fim do mês
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
    if (quickPeriod === "today") {
      setStartDateStr(toDateInputValue(now));
      setEndDateStr(toDateInputValue(now));
    }
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
      // ✅ 19/08: MRR vem pronto da edge (v30) — preço vigente pros PIX e
      // preço antigo pros legados do Stripe. Fallback local só se a edge
      // for versão velha sem o campo.
      const mrrMonthlyVal = safeNum(pix.mrr?.monthly) || activeMonthly * PRICE_MONTHLY;
      const mrrQuarterlyVal = safeNum(pix.mrr?.quarterly) || (activeQuarterly * PRICE_QUARTERLY) / 3;
      const mrrTotalVal = safeNum(pix.mrr?.total) || mrrMonthlyVal + mrrQuarterlyVal;

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
        avulso_total: safeNum(pix.avulso?.total),
        avulso_qtd_vendas: safeNum(pix.avulso?.qtd_vendas),
        avulso_qtd_pessoas: safeNum(pix.avulso?.qtd_pessoas),
      });

      setSoldByChannel({
        bot: {
          total: safeNum(pix.sold_by_channel?.bot?.total),
          mensal: safeNum(pix.sold_by_channel?.bot?.mensal),
          trimestral: safeNum(pix.sold_by_channel?.bot?.trimestral),
          revenue_estimated: safeNum(pix.sold_by_channel?.bot?.revenue_estimated),
        },
        site: {
          total: safeNum(pix.sold_by_channel?.site?.total),
          mensal: safeNum(pix.sold_by_channel?.site?.mensal),
          trimestral: safeNum(pix.sold_by_channel?.site?.trimestral),
          revenue_estimated: safeNum(pix.sold_by_channel?.site?.revenue_estimated),
        },
      });

      setRetD30({
        base_com_30_dias: safeNum(pix.d30_base),
        ainda_ativos: safeNum(pix.d30_retained),
        retencao_d30: safeNum(pix.d30_rate),
      });

      const avConv = pix.avulso_conversion || {};
      setAvulsoConversion({
        pessoas_total: safeNum(avConv.pessoas_total),
        com_cadastro: safeNum(avConv.com_cadastro),
        ja_assinaram: safeNum(avConv.ja_assinaram),
        assinaram_depois: safeNum(avConv.assinaram_depois),
        ativos_agora: safeNum(avConv.ativos_agora),
      });

      const sg = pix.signups || {};
      const normSignup = (o) => ({
        signups: safeNum(o?.signups),
        paid: safeNum(o?.paid),
        conversion_rate: safeNum(o?.conversion_rate),
      });
      setSignups({
        period: normSignup(sg.period),
        compare: normSignup(sg.compare),
        today: normSignup(sg.today),
        yesterday: normSignup(sg.yesterday),
        this_month: normSignup(sg.this_month),
        last_month: normSignup(sg.last_month),
      });

      const loyalData = pix.loyal || {};
      setLoyal({
        active_total: safeNum(loyalData.active_total),
        renewed_once: safeNum(loyalData.renewed_once),
        renewed_twice_plus: safeNum(loyalData.renewed_twice_plus),
      });

      setTierComposition(Array.isArray(pix.tier_composition) ? pix.tier_composition : []);
      setTierRetention(Array.isArray(pix.tier_retention_reference) ? pix.tier_retention_reference : []);

      const churnPeriod = pix.churn?.period || {};
      const churnCompare = pix.churn?.compare_period || {};
      setChurn({
        period: {
          new: safeNum(churnPeriod.new),
          cohort: safeNum(churnPeriod.cohort),
          retained: safeNum(churnPeriod.retained),
          churned: safeNum(churnPeriod.churned),
          retention_rate: safeNum(churnPeriod.retention_rate),
          winback: safeNum(churnPeriod.winback),
          winback_rate: safeNum(churnPeriod.winback_rate),
        },
        compare_period: {
          new: safeNum(churnCompare.new),
          cohort: safeNum(churnCompare.cohort),
          retained: safeNum(churnCompare.retained),
          churned: safeNum(churnCompare.churned),
          retention_rate: safeNum(churnCompare.retention_rate),
          winback: safeNum(churnCompare.winback),
          winback_rate: safeNum(churnCompare.winback_rate),
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
  const avulsoTotal = useMemo(() => safeNum(metrics.avulso_total), [metrics.avulso_total]);
  const avulsoQtdPessoas = useMemo(() => safeNum(metrics.avulso_qtd_pessoas), [metrics.avulso_qtd_pessoas]);
  const avulsoQtdVendas = useMemo(() => safeNum(metrics.avulso_qtd_vendas), [metrics.avulso_qtd_vendas]);

  const avgTicket = useMemo(() => {
    const denom = safeNum(metrics.active_now);
    if (!denom) return 0;
    return mrrTotal / denom;
  }, [metrics.active_now, mrrTotal]);

  // "Taxa real de recuperação" só conta quem pagou de novo DEPOIS do fim do
  // período — se o período selecionado ainda não fechou (ex.: "Este mês"),
  // trava em 0% sempre, não é bug. Usado pra avisar isso na tela.
  const periodStillOpen = useMemo(() => periodEnd.getTime() > Date.now() - 5 * 60 * 1000, [periodEnd]);

  // “Janela” explicativa da Retenção D30 (pra não confundir com o filtro do período)
  const retentionWindowLabel = useMemo(() => {
    const today = new Date();
    const cohortStart = addDays(today, -60);
    const cohortEnd = addDays(today, -30);
    return `Coorte: ${formatBRDate(cohortStart)} até ${formatBRDate(cohortEnd)} • Medição em: ${formatBRDate(today)}`;
  }, []);

  // UI
  const renderCard = (title, value, icon, subtitle, tone = "default", tooltip = null) => {
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
            <div className="text-xs md:text-sm text-white/70 font-medium flex items-center gap-1">
              {title}
              <InfoTooltip text={tooltip} />
            </div>
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

      <AdminTabs />

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

            {/* ✅ 20/08 — atalho pro PULSO (dashboard com gráficos/projeção) */}
            <button
              onClick={() => goTab("/admin/pulso")}
              className="px-3 py-2 rounded-lg text-sm border bg-gradient-to-r from-purple-500/25 to-fuchsia-500/20 border-purple-400/40 font-semibold"
            >
              📈 Pulso
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
                <option value="today">Hoje</option>
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
            {/* ✅ 19/08 reorg ("tá muito bagunçado"): a página agora tem 4
                seções por PERGUNTA — Agora / No período do filtro / Base e
                retenção / Extras. Antes eram 20+ cards misturando 5 janelas
                de tempo diferentes sem nenhuma hierarquia visual. */}
            <SectionTitle title="Agora" hint="retrato deste momento — não depende do filtro de período" />
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-3">
                {renderCard(
                  "Ativos agora",
                  `${metrics.active_now}`,
                  <Users className="w-5 h-5 text-green-300" />,
                  `Mensal: ${metrics.active_now_monthly} • Trimestral: ${metrics.active_now_quarterly}`,
                  "ok",
                  "Quantas pessoas estão com assinatura válida agora, neste exato segundo. Não é do período do filtro lá em cima — é o retrato de agora."
                )}
              </div>

              <div className="md:col-span-3">
                {renderCard(
                  "MRR (total)",
                  formatBRL(mrrTotal),
                  <BarChart3 className="w-5 h-5 text-purple-300" />,
                  "Preço vigente + legado Stripe no preço antigo",
                  "default",
                  "Quanto essa base de assinantes vale por mês, tipo 'piloto automático'. Calculado no servidor com o preço certo de cada grupo: quem paga via Pix usa o preço atual (17,90/49,90) e os ~300 assinantes antigos do Stripe usam o preço da época deles (15,90/43,90)."
                )}
              </div>

              <div className="md:col-span-3">
                {renderCard(
                  "MRR Mensal",
                  formatBRL(mrrMonthly),
                  <CreditCard className="w-5 h-5 text-white/70" />,
                  `${metrics.active_now_monthly} assinaturas`,
                  "default",
                  "A fatia do MRR (valor mensal recorrente) que vem só de quem paga o plano mensal."
                )}
              </div>

              <div className="md:col-span-3">
                {renderCard(
                  "MRR Trimestral (÷ 3)",
                  formatBRL(mrrQuarterly),
                  <CreditCard className="w-5 h-5 text-yellow-300" />,
                  `${metrics.active_now_quarterly} assinaturas`,
                  "default",
                  "A fatia do MRR de quem paga trimestral, dividida por 3 — senão contaria os 3 meses de uma vez e inflaria o número."
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-4">
                {renderCard(
                  "Cadastros hoje",
                  `${signups.today.signups}`,
                  <Users className="w-5 h-5 text-cyan-300" />,
                  `Pagaram: ${signups.today.paid} (${signups.today.conversion_rate}%) • Ontem: ${signups.yesterday.signups} → ${signups.yesterday.paid} (${signups.yesterday.conversion_rate}%)`,
                  "default",
                  "Contas criadas hoje (desde 00:00 em Brasília) e quantas delas já pagaram. Ontem aparece do lado pra comparar. Mesma conta do relatório diário por e-mail."
                )}
              </div>
              <div className="md:col-span-4">
                {renderCard(
                  "Cadastros este mês",
                  `${signups.this_month.signups}`,
                  <Users className="w-5 h-5 text-cyan-300" />,
                  `Pagaram: ${signups.this_month.paid} (${signups.this_month.conversion_rate}%) • Mês passado: ${signups.last_month.signups} → ${signups.last_month.paid} (${signups.last_month.conversion_rate}%)`,
                  "default",
                  "Contas criadas do dia 1 até agora e quantas já pagaram. Mês passado inteiro aparece do lado pra comparar."
                )}
              </div>
              <div className="md:col-span-4">
                {renderCard(
                  "Pendentes agora",
                  `${metrics.pending_now}`,
                  <Clock className="w-5 h-5 text-yellow-300" />,
                  "Pix gerado e nunca pago (acumulado)",
                  "warn",
                  "Pessoas que geraram um Pix pra pagar mas ainda não pagaram — acumulado de toda a história, não só do período. Ainda não é dinheiro no bolso, é intenção de compra."
                )}
              </div>
            </div>

            <SectionTitle title="No período do filtro" hint={periodLabel} />
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-4">
                {renderCard(
                  "Faturamento (período)",
                  formatBRL(revenuePeriod),
                  <CreditCard className="w-5 h-5 text-blue-300" />,
                  "Aproximação: soma das vendas no período",
                  "default",
                  "Quanto dinheiro entrou de verdade (pagamentos já confirmados) dentro do período que você escolheu no filtro."
                )}
              </div>
              <div className="md:col-span-4">
                {renderCard(
                  "Conversão (período)",
                  `${signups.period.conversion_rate}%`,
                  <BarChart3 className="w-5 h-5 text-cyan-300" />,
                  `${signups.period.paid} pagaram de ${signups.period.signups} cadastros no período do filtro`,
                  signups.period.conversion_rate >= 15 ? "ok" : signups.period.conversion_rate >= 10 ? "warn" : "default",
                  "Conversão de quem se cadastrou DENTRO do período escolhido no filtro lá em cima. É o mesmo número que aparece como '% Desses, pagaram' no e-mail diário quando o período é o dia."
                )}
              </div>
              <div className="md:col-span-4">
                {renderCard(
                  "Conversão (comparação)",
                  `${signups.compare.conversion_rate}%`,
                  <BarChart3 className="w-5 h-5 text-cyan-300" />,
                  `${signups.compare.paid} pagaram de ${signups.compare.signups} cadastros no período de comparação`,
                  "default",
                  "Mesma conta, só que no período de comparação (por padrão, a mesma quantidade de dias um mês antes). Serve pra ver se a conversão tá subindo ou caindo."
                )}
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
                    "ok",
                    "Quantos pagamentos (novos ou renovações) fecharam dentro do período, somando mensal + trimestral."
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Vendas (mensal)",
                    `${metrics.sold_monthly}`,
                    <CreditCard className="w-5 h-5 text-white/70" />,
                    `Preço: ${formatBRL(PRICE_MONTHLY)}`,
                    "default",
                    "O mesmo de cima, mas só contando quem pagou o plano mensal."
                  )}
                </div>

                <div className="md:col-span-4">
                  {renderCard(
                    "Vendas (trimestral)",
                    `${metrics.sold_quarterly}`,
                    <CreditCard className="w-5 h-5 text-yellow-300" />,
                    `Preço: ${formatBRL(PRICE_QUARTERLY)}`,
                    "default",
                    "O mesmo de cima, mas só contando quem pagou o plano trimestral."
                  )}
                </div>
              </div>
            </div>


            {/* Vendas por canal — Bot (WhatsApp) x Site — perto do faturamento, de propósito */}
            <div className="mt-3">
              <div className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1">
                Vendas por canal (Bot x Site)
                <InfoTooltip text='Mesmas vendas do faturamento acima, discriminadas por origem. "Bot" = fechou a compra na conversa com o bot de vendas do WhatsApp (pix_payments.source = whatsapp_sales_bot). "Site" = todo o resto — checkout direto no site, Stripe, PIX manual, ads, lembrete de renovação, Dora chat.' />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  {renderCard(
                    "🤖 Bot (WhatsApp)",
                    `${soldByChannel.bot.total}`,
                    <Users className="w-5 h-5 text-emerald-300" />,
                    `Mensal: ${soldByChannel.bot.mensal} • Trimestral: ${soldByChannel.bot.trimestral} • ${formatBRL(soldByChannel.bot.revenue_estimated)}`,
                    "ok",
                    "Vendas de assinatura fechadas na conversa com o bot de vendas do WhatsApp, no período selecionado."
                  )}
                </div>

                <div>
                  {renderCard(
                    "🌐 Site",
                    `${soldByChannel.site.total}`,
                    <Users className="w-5 h-5 text-blue-300" />,
                    `Mensal: ${soldByChannel.site.mensal} • Trimestral: ${soldByChannel.site.trimestral} • ${formatBRL(soldByChannel.site.revenue_estimated)}`,
                    "default",
                    "Todo o resto: checkout direto no site, Stripe, PIX manual do admin, ads, lembrete de renovação por WhatsApp/email, Dora chat."
                  )}
                </div>
              </div>
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
                    "ok",
                    "Gente que assinou PELA PRIMEIRA VEZ dentro do período escolhido — nunca tinha pago antes."
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Saíram no período",
                    `${churn.period.churned}`,
                    <UserMinus className="w-5 h-5 text-red-300" />,
                    `De ${churn.period.cohort} ativos no início do período`,
                    churn.period.churned > 0 ? "bad" : "default",
                    "Imagina um balde com água: de quem já pagava assinatura no começo do período, esses aqui 'vazaram' — pararam de pagar e perderam o acesso até o fim do período."
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retidos no período",
                    `${churn.period.retained}`,
                    <Users className="w-5 h-5 text-white/70" />,
                    `De ${churn.period.cohort} ativos no início do período`,
                    "default",
                    "O oposto de quem saiu: de quem já pagava no começo do período, esses continuaram pagando até o fim dele. Ficaram dentro do balde."
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retenção do período",
                    formatPct(churn.period.retention_rate),
                    <TrendingUp className="w-5 h-5 text-green-300" />,
                    "Retidos ÷ ativos no início",
                    "ok",
                    "Retidos dividido por quem tinha assinatura no início, em %. É o espelho do churn: Retenção% + Churn% sempre soma 100%."
                  )}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-3">
                  {renderCard(
                    "Taxa real de recuperação",
                    formatPct(churn.period.winback_rate),
                    <TrendingUp className="w-5 h-5 text-green-300" />,
                    `${churn.period.winback} de quem perdeu já voltou a pagar`,
                    periodStillOpen ? "warn" : "ok",
                    "De quem perdeu a assinatura NESSE período específico, quantos % já voltaram a pagar DEPOIS que o período fechou. Diferente da retenção: esse número só sobe com o tempo (nunca cai). Só funciona direito em período JÁ FECHADO (ex.: 'Mês passado') — em período ainda em andamento (ex.: 'Este mês'), trava em 0% sempre, porque ainda não existe 'depois' pra medir."
                  )}
                </div>
              </div>
              {periodStillOpen ? (
                <div className="mt-2 text-xs text-yellow-200/70">
                  ⚠️ O período selecionado ainda está em andamento — essa taxa sempre fica em 0% aqui até o período
                  fechar. Selecione "Mês passado" (ou um período personalizado já encerrado) pra ver o número real.
                </div>
              ) : null}

              <div className="mt-4 text-xs text-white/50">Comparação — {compareLabel}</div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-3">
                  {renderCard(
                    "Entraram (comparação)",
                    `${churn.compare_period.new}`,
                    <UserPlus className="w-5 h-5 text-white/50" />,
                    "Primeira assinatura no período comparado",
                    "default",
                    "O mesmo de 'Entraram no período', só que calculado pro período de comparação — pra você ver se melhorou ou piorou."
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Saíram (comparação)",
                    `${churn.compare_period.churned}`,
                    <UserMinus className="w-5 h-5 text-white/50" />,
                    `De ${churn.compare_period.cohort} ativos no início`,
                    "default",
                    "O mesmo do 'balde furado' de 'Saíram no período', só que calculado pro período de comparação."
                  )}
                </div>

                <div className="md:col-span-3">
                  {renderCard(
                    "Retidos (comparação)",
                    `${churn.compare_period.retained}`,
                    <Users className="w-5 h-5 text-white/50" />,
                    `De ${churn.compare_period.cohort} ativos no início`,
                    "default",
                    "O mesmo de 'Retidos no período', só que calculado pro período de comparação."
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
                    churn.period.retention_rate >= churn.compare_period.retention_rate ? "ok" : "bad",
                    "A retenção (retidos ÷ ativos no início), só que do período de comparação — o ícone mostra se a retenção do período principal está melhor (seta verde) ou pior (seta vermelha) que essa aqui."
                  )}
                </div>
              </div>

              <div className="mt-2 text-xs text-white/45">
                "Ativo no início" = cobertura reconstruída a partir do histórico de renovações. "Retido" = a
                assinatura atual do usuário ainda cobre o fim do período em questão (mesma regra do gate de acesso).
              </div>
            </div>


            {/* ✅ 20/08 — limpeza pós-Pulso (decisão do Stefano): "Assinantes
                fiéis", "Funil de lealdade" e "Retenção D30" saíram DAQUI —
                viviam duplicados/competindo com as versões melhores do Pulso
                (funil visual, retenção 30d com gráfico de evolução, simulador).
                Analytics = operação do período; Pulso = tendência/estratégia. */}
            <SectionTitle title="Base e retenção" hint="mudou de casa" />
            <button
              type="button"
              onClick={() => goTab("/admin/pulso")}
              className="mt-3 w-full text-left rounded-2xl bg-gradient-to-r from-purple-500/15 to-fuchsia-500/10 border border-purple-400/30 p-4 hover:from-purple-500/25 transition-colors"
            >
              <div className="text-sm font-semibold text-white/90">📈 Retenção, funil de lealdade e projeções agora moram no Pulso →</div>
              <div className="text-xs text-white/55 mt-1">
                Lá tem a retenção 30d com o gráfico de evolução (abril até hoje), o funil visual com a % de renovação
                por degrau, o ponto de equilíbrio de entrada e o simulador de 12 meses. Clique pra abrir.
              </div>
            </button>


            <SectionTitle title="Extras" hint="métricas de nicho — abre só quando precisar" />
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-white/60 hover:text-white/80 font-medium select-none py-1">Vendas avulsas (R$ 10) e conversão do avulso → assinante</summary>
            {/* Vendas avulsas (R$10, dorama único via bot WhatsApp) — separado do faturamento acima */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-4">
                {renderCard(
                  "Vendas avulsas (R$ 10)",
                  formatBRL(avulsoTotal),
                  <CreditCard className="w-5 h-5 text-pink-300" />,
                  `${avulsoQtdPessoas} pessoa${avulsoQtdPessoas === 1 ? "" : "s"} • ${avulsoQtdVendas} venda${avulsoQtdVendas === 1 ? "" : "s"} no período`,
                  "default",
                  "Vendas do dorama avulso de R$ 10,00 (link único, vendido pelo bot do WhatsApp). Esse valor é separado e NÃO entra na conta do \"Faturamento (período)\" acima, pra não te confundir com o faturamento de assinatura."
                )}
              </div>

              <div className="md:col-span-8">
                {renderCard(
                  "Avulso → assinante (vitalício)",
                  `${avulsoConversion.assinaram_depois} converteram`,
                  <Users className="w-5 h-5 text-pink-300" />,
                  `De ${avulsoConversion.pessoas_total} pessoas que já compraram avulso, só ${avulsoConversion.com_cadastro} têm conta com o mesmo telefone • ${avulsoConversion.ativos_agora} estão assinantes ativos agora`,
                  "default",
                  "De TODO MUNDO que já comprou o avulso de R$10 (histórico completo, não é só o período do filtro), quantos depois criaram conta e assinaram de verdade. LIMITAÇÃO: a compra avulsa não salva conta de usuário, só o telefone — então só enxergamos quem assinou usando o MESMO número de telefone que usou no bot. Quem assinou com outro número não aparece aqui, então esse número é um piso (o real tende a ser maior)."
                )}
              </div>
            </div>

            </details>

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

/** Cabeçalho de seção (reorg 19/08): divide a página por pergunta */
function SectionTitle({ title, hint }) {
  return (
    <div className="mt-8 mb-3 flex items-center gap-3 flex-wrap">
      <div className="text-sm font-extrabold tracking-widest uppercase text-white/90">{title}</div>
      <div className="h-px flex-1 min-w-[40px] bg-white/10" />
      {hint ? <div className="text-[11px] text-white/40">{hint}</div> : null}
    </div>
  );
}

/** "?" com explicação simples ao passar o mouse por cima */
function InfoTooltip({ text }) {
  if (!text) return null;
  return (
    <span className="relative inline-flex group align-middle">
      <HelpCircle className="w-3.5 h-3.5 text-white/40 hover:text-white/70 cursor-help" />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-60 rounded-lg bg-black/95 border border-white/15 px-3 py-2 text-xs font-normal normal-case text-white/90 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
        {text}
      </span>
    </span>
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
