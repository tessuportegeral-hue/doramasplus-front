import React, { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate } from "react-router-dom";
import { Activity, Loader2, TrendingUp, Users, Wallet, Target, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import AdminTabs from "@/components/AdminTabs";

// ============================================================================
// PULSO — dashboard financeiro do DoramasPlus (✅ 20/08, pedido do Stefano:
// "dashboard com gráficos, funis, projeções... algo maravilhoso").
// Dados: edge function admin-pulso (séries diárias 90d, mensais desde março,
// funil dedupado por mês, KPIs). Gráficos: SVG próprio, zero lib.
// ============================================================================

// ---------- formatadores -----------------------------------------------------
const fmtBRL = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtInt = (v) => (Number(v) || 0).toLocaleString("pt-BR");
const fmtAxis = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
};
const MES_LABEL = { "01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago", "09": "Set", "10": "Out", "11": "Nov", "12": "Dez" };
const mesCurto = (ym) => MES_LABEL[String(ym).slice(5, 7)] || ym;
const diaCurto = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// média móvel simples
const movingAvg = (arr, w) =>
  arr.map((_, i) => {
    const s = Math.max(0, i - w + 1);
    const slice = arr.slice(s, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

// ---------- gráfico de área/linha com tooltip --------------------------------
// Segue a cartilha: linha 2px, grid recessivo, 1 eixo só, ponto final
// destacado com rótulo direto, tooltip por proximidade.
function AreaChart({ labels, series, fmt = fmtAxis, height = 220, valueFmt }) {
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = height;
  const padL = 44;
  const padR = 14;
  const padT = 14;
  const padB = 22;
  const vFmt = valueFmt || fmt;

  const all = series.flatMap((s) => s.data);
  const maxV = Math.max(1, ...all);
  const n = Math.max(2, labels.length);
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);

  const paths = series.map((s) => s.data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "));
  const areaPath = `${paths[0]} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => f * maxV);
  const gid = useMemo(() => `g${Math.random().toString(36).slice(2, 8)}`, []);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
    if (i >= 0 && i < n) setHover(i);
  };

  const last = series[0].data[n - 1];

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" onMouseMove={onMove} style={{ touchAction: "pan-y" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[0].color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={series[0].color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.38)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmt(v)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill={`url(#${gid})`} />
        {series.map((s, si) => (
          <path key={si} d={paths[si]} fill="none" stroke={s.color} strokeWidth={si === 0 ? 2 : 1.5}
            strokeDasharray={s.dashed ? "4 4" : undefined} strokeLinejoin="round" strokeLinecap="round" opacity={si === 0 ? 1 : 0.85} />
        ))}
        {/* ponto final destacado + rótulo direto */}
        <circle cx={x(n - 1)} cy={y(last)} r="3.5" fill={series[0].color} stroke="#0b0f17" strokeWidth="1.5" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            {series.map((s, si) => (
              <circle key={si} cx={x(hover)} cy={y(s.data[hover])} r="3" fill={s.color} stroke="#0b0f17" strokeWidth="1.5" />
            ))}
          </g>
        )}
        {/* eixo x: primeiro, meio, último */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10" fill="rgba(255,255,255,0.38)">
            {labels[i]}
          </text>
        ))}
      </svg>

      {hover != null && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg bg-slate-950/95 border border-white/10 px-2.5 py-1.5 text-xs shadow-xl z-10 whitespace-nowrap"
          // ✅ 20/08 — clamp 12–88%: perto da borda o tooltip vazava do card e
          // criava rolagem LATERAL da página inteira (flagrado no celular)
          style={{ left: `${Math.min(88, Math.max(12, ((padL + (hover / (n - 1)) * (W - padL - padR)) / W) * 100))}%` }}
        >
          <div className="text-white/50 mb-0.5">{labels[hover]}</div>
          {series.map((s, si) => (
            <div key={si} className="flex items-center gap-1.5" style={{ fontVariantNumeric: "tabular-nums" }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
              <span className="text-white/70">{s.label}:</span>
              <span className="font-semibold text-white">{vFmt(s.data[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- barras com tooltip ----------------------------------------------
function Bars({ labels, data, color, fmt = fmtInt, height = 160, compare }) {
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = height;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const maxV = Math.max(1, ...data, ...(compare ? compare.data : []));
  const n = Math.max(1, data.length);
  const slot = (W - padL - padR) / n;
  const bw = compare ? Math.max(2, slot * 0.34) : Math.max(2, slot * 0.62);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block">
        {[0.5, 1].map((f, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(f * maxV)} y2={y(f * maxV)} stroke="rgba(255,255,255,0.07)" />
            <text x={padL - 6} y={y(f * maxV) + 3} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.38)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtAxis(f * maxV)}
            </text>
          </g>
        ))}
        {data.map((v, i) => {
          const cx = padL + i * slot + slot / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              {/* alvo de toque maior que a barra */}
              <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              <rect x={compare ? cx - bw - 1 : cx - bw / 2} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx="2" fill={color} opacity={hover === i ? 1 : 0.82} />
              {compare && (
                <rect x={cx + 1} y={y(compare.data[i] || 0)} width={bw} height={Math.max(0, y(0) - y(compare.data[i] || 0))} rx="2" fill={compare.color} opacity={hover === i ? 1 : 0.82} />
              )}
            </g>
          );
        })}
        {labels.map((l, i) =>
          n <= 8 || i % Math.ceil(n / 8) === 0 ? (
            <text key={i} x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.38)">
              {l}
            </text>
          ) : null
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg bg-slate-950/95 border border-white/10 px-2.5 py-1.5 text-xs shadow-xl z-10 whitespace-nowrap"
          style={{ left: `${Math.min(88, Math.max(12, ((padL + hover * slot + slot / 2) / W) * 100))}%`, fontVariantNumeric: "tabular-nums" }}
        >
          <div className="text-white/50 mb-0.5">{labels[hover]}</div>
          <div className="text-white font-semibold">{fmt(data[hover])}</div>
          {compare && <div className="text-white/70">{compare.label}: {fmt(compare.data[hover] || 0)}</div>}
        </div>
      )}
    </div>
  );
}

// ---------- tile de KPI ------------------------------------------------------
function Kpi({ icon: Icon, label, value, sub, accent = "#a855f7", delta }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-center gap-2 text-xs text-white/55 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="mt-0.5 text-xs text-white/50 flex items-center gap-2" style={{ fontVariantNumeric: "tabular-nums" }}>
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${delta >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

// ============================================================================
export default function AdminPulso() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) { navigate("/login"); return; }
      const { data: prof } = await supabase.from("profiles").select("is_admin").eq("id", auth.user.id).maybeSingle();
      if (!mounted) return;
      setIsAdmin(prof?.is_admin === true);
      setChecked(true);
    })();
    return () => { mounted = false; };
  }, [navigate]);

  const fetchData = async () => {
    setLoading(true);
    setErro("");
    const { data, error } = await supabase.functions.invoke("admin-pulso", { body: {} });
    if (error || data?.error) setErro(String(error?.message || data?.error || "erro"));
    else setPayload(data);
    setLoading(false);
  };

  useEffect(() => {
    if (checked && isAdmin) fetchData();
  }, [checked, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ 20/08 (pedido do Stefano): o painel se atualiza SOZINHO — a cada 60s
  // com a aba visível, e na hora em que a aba volta a ficar visível. O
  // payload antigo fica na tela durante o refetch (nada pisca).
  useEffect(() => {
    if (!checked || !isAdmin) return;
    const tick = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    const id = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [checked, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- derivados ------------------------------------------------------
  const d = payload;
  const daily = d?.daily || [];
  const monthly = d?.monthly || [];
  const funnel = d?.funnel || [];
  const funnelRet = d?.funnel_retention || [];
  const kpis = d?.kpis || {};

  const fatArr = daily.map((r) => Number(r.fat) || 0);
  const vendasArr = daily.map((r) => Number(r.vendas) || 0);
  const cadArr = daily.map((r) => Number(r.cadastros) || 0);
  const dayLabels = daily.map((r) => diaCurto(r.dia));

  const fat30 = fatArr.slice(-30).reduce((a, b) => a + b, 0);
  const fat30prev = fatArr.slice(-60, -30).reduce((a, b) => a + b, 0);
  const fatDelta = fat30prev > 0 ? ((fat30 - fat30prev) / fat30prev) * 100 : null;
  const vendas30 = vendasArr.slice(-30).reduce((a, b) => a + b, 0);
  const ritmo7 = fatArr.slice(-7).reduce((a, b) => a + b, 0) / 7;

  const totalFunil = funnel.reduce((a, r) => a + Number(r.qtd), 0);
  const retTotais = funnelRet.reduce(
    (acc, r) => ({ cohort: acc.cohort + Number(r.cohort), ret: acc.ret + Number(r.retidos) }),
    { cohort: 0, ret: 0 }
  );
  const retGeral = retTotais.cohort > 0 ? retTotais.ret / retTotais.cohort : 0.55;

  // defaults da projeção vindos dos DADOS
  // ✅ 20/08 fix (flagrado pelo Stefano): usava a média dos 2 últimos meses
  // FECHADOS (1.641) enquanto o ritmo real dos últimos 30 dias era 830 — a
  // projeção mostrava crescimento com a base caindo. Agora o default é o
  // ritmo real de 30 dias (kpis.novos_30d).
  const lastFullMonths = monthly.slice(-3, -1);
  const novosDefault = Number(kpis.novos_30d) || Math.round(
    lastFullMonths.length ? lastFullMonths.reduce((a, m) => a + Number(m.novos), 0) / lastFullMonths.length : 800
  );
  const ticketDefault = Number(kpis.arpu) || 17.9;

  const [pNovos, setPNovos] = useState(null);
  const [pRet, setPRet] = useState(null); // ajuste em pontos % sobre TODOS os degraus do funil
  const [pTicket, setPTicket] = useState(null);
  const novos = pNovos ?? novosDefault;
  const adj = pRet ?? 0;
  const ticket = pTicket ?? Math.round(ticketDefault * 10) / 10;

  // ✅ 20/08 — MODELO POR COORTES (objeção do Stefano: "a base amadurece e
  // fica mais propensa a renovar — média fixa tá errada"). Agora cada leva
  // desce o funil REAL degrau a degrau (22% no 1º ciclo → 49% → 58% → 82%
  // nos veteranos): quem sobrevive retém mais SOZINHO dentro da conta, e a
  // simulação parte da composição ATUAL da base (funil de hoje), não de um
  // bolo homogêneo. O slider de retenção virou ajuste em pontos % aplicado
  // a todos os degraus.
  const tierRates = useMemo(() => {
    const map = {};
    for (const r of funnelRet) {
      if (Number(r.cohort) >= 8) map[Number(r.faixa)] = Number(r.retidos) / Number(r.cohort);
    }
    return map;
  }, [funnelRet]);

  const rateFor = (k, adjPp) => {
    let base = tierRates[k];
    if (base == null) {
      for (let j = k; j >= 0; j--) if (tierRates[j] != null) { base = tierRates[j]; break; }
      if (base == null) base = 0.5;
      if (k >= 4) base = Math.max(base, 0.7); // veterano sem amostra: assume fiel
    }
    return Math.min(0.97, Math.max(0.02, base + adjPp / 100));
  };

  const simulate = (months, nNovos, adjPp) => {
    const K = 12; // último bucket acumula os 12x+
    let state = new Array(K + 1).fill(0);
    for (const row of funnel) {
      const f = Math.min(K, Number(row.faixa) || 0);
      state[f] += Number(row.qtd) || 0;
    }
    const soma = (arr) => arr.reduce((a, b) => a + b, 0);
    const out = [soma(state)];
    for (let m = 1; m <= months; m++) {
      const next = new Array(K + 1).fill(0);
      next[0] = nNovos;
      for (let k = 0; k <= K; k++) {
        const surv = state[k] * rateFor(k, adjPp);
        if (k === K) next[K] += surv;
        else next[k + 1] += surv;
      }
      state = next;
      out.push(soma(state));
    }
    // estado final junto, pra dar pra mostrar a MISTURA da base projetada
    // (fatia de 1º ciclo e retenção média implícita) — resposta à discussão
    // "a base vai amadurecendo": depende da torneira, e agora dá pra VER.
    return { out, state };
  };

  const proj = useMemo(() => {
    // mês 0 = HOJE (composição real do funil); 12 meses por coortes.
    const sim = simulate(12, novos, adj);
    const meses = sim.out.map((b, i) => ({ m: i, base: Math.round(b), receita: Math.round(b * ticket) }));
    // teto = onde a entrada empata com as saídas do funil (simulado 60 meses)
    const longo = simulate(60, novos, adj);
    const equilibrio = Math.round(longo.out[longo.out.length - 1]);
    const acumulado = meses.slice(1).reduce((a, x) => a + x.receita, 0);
    // mistura da base em +12m: fatia no 1º ciclo e retenção média implícita
    const st = sim.state;
    const totalFim = st.reduce((a, b) => a + b, 0);
    const pctNovataFim = totalFim > 0 ? (st[0] / totalFim) * 100 : 0;
    const retMediaFim = totalFim > 0
      ? (st.reduce((a, v, k) => a + v * rateFor(k, adj), 0) / totalFim) * 100
      : 0;
    return { meses, equilibrio, acumulado, pctNovataFim, retMediaFim };
  }, [funnel, tierRates, novos, adj, ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ 20/08 (pedido do Stefano): PONTO DE EQUILÍBRIO na tela.
  // - multiplicador do funil: rastro que 1 novo deixa ao longo da vida
  //   (1 + sobreviventes degrau a degrau) → teto da base = novos × mult
  // - estancar: saídas do MÊS ATUAL com a composição real do funil
  // - segurar: novos/mês pra base atual virar o próprio equilíbrio
  // Tudo reage ao slider de retenção (rateFor com adj).
  const equil = useMemo(() => {
    let mult = 1, s = 1;
    for (let k = 0; k < 60; k++) {
      s *= rateFor(Math.min(12, k), adj);
      mult += s;
      if (s < 0.0001) break;
    }
    const baseNow = Number(kpis.active_now) || 0;
    let exits = 0;
    for (const row of funnel) {
      const k = Math.min(12, Number(row.faixa) || 0);
      exits += (Number(row.qtd) || 0) * (1 - rateFor(k, adj));
    }
    return {
      mult,
      estancar: Math.round(exits),
      segurar: mult > 0 ? Math.round(baseNow / mult) : 0,
    };
  }, [funnel, tierRates, adj, kpis.active_now]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCenario = (tipo) => {
    if (tipo === "atual") { setPNovos(null); setPRet(null); setPTicket(null); }
    if (tipo === "pessimista") { setPNovos(Math.round(novosDefault * 0.7)); setPRet(-5); setPTicket(Math.round(ticketDefault * 10) / 10); }
    if (tipo === "otimista") { setPNovos(Math.round(novosDefault * 1.5)); setPRet(7); setPTicket(Math.round(ticketDefault * 10) / 10); }
  };

  if (!checked) {
    return (
      <div className="min-h-screen bg-[#0b0f17] flex items-center justify-center text-white/70">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Validando admin...
      </div>
    );
  }
  if (!isAdmin) {
    return <div className="min-h-screen bg-[#0b0f17] flex items-center justify-center text-white/70">Sem permissão.</div>;
  }

  return (
    <div className="min-h-screen bg-[#0b0f17] text-white [color-scheme:dark] overflow-x-hidden">
      <Helmet><title>Pulso | DoramasPlus</title></Helmet>
      <AdminTabs />

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-6 h-6 text-purple-300" />
              <h1 className="text-xl md:text-2xl font-semibold">Pulso</h1>
            </div>
            <p className="text-sm text-white/60 mt-1">
              A saúde financeira do DoramasPlus num olhar: séries, funil e projeção — direto do banco, agora.
            </p>
          </div>
          <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 hover:bg-white/10">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </button>
        </div>

        {erro && <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 px-4 py-3 text-sm text-rose-200">Erro ao carregar: {erro}</div>}
        {loading && !payload && (
          <div className="flex items-center gap-2 text-white/60 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Carregando as séries...</div>
        )}

        {payload && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi icon={Wallet} label="MRR agora" accent="#a855f7" value={fmtBRL(kpis.mrr)}
                sub={`${fmtInt(kpis.active_monthly)} mensais + ${fmtInt(kpis.active_quarterly)} trimestrais`} />
              <Kpi icon={TrendingUp} label="Faturamento 30d" accent="#34d399" value={fmtBRL(fat30)} delta={fatDelta}
                sub={`vs 30d anteriores · ${fmtInt(vendas30)} vendas`} />
              <Kpi icon={Users} label="Base ativa" accent="#38bdf8" value={fmtInt(kpis.active_now)}
                sub={`retenção 30d: ${(retGeral * 100).toFixed(0)}% · ticket ${fmtBRL(kpis.arpu)}`} />
              <Kpi icon={Target} label="Ritmo diário (7d)" accent="#f59e0b" value={fmtBRL(ritmo7)}
                sub={`≈ ${fmtBRL(ritmo7 * 30)} no mês nesse ritmo`} />
            </div>

            {/* faturamento diário */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-white/80">Faturamento diário — últimos 90 dias</h2>
                <span className="text-xs text-white/45">linha tracejada = média 7 dias</span>
              </div>
              <AreaChart
                labels={dayLabels}
                valueFmt={fmtBRL}
                series={[
                  { label: "Faturamento", data: fatArr, color: "#34d399" },
                  { label: "Média 7d", data: movingAvg(fatArr, 7), color: "#a7f3d0", dashed: true },
                ]}
              />
            </div>

            {/* vendas + cadastros */}
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <h2 className="text-sm font-semibold text-white/80 mb-2">Vendas por dia</h2>
                <Bars labels={dayLabels} data={vendasArr} color="#a855f7" />
              </div>
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <h2 className="text-sm font-semibold text-white/80 mb-2">Cadastros por dia</h2>
                <AreaChart labels={dayLabels} valueFmt={fmtInt} height={160}
                  series={[{ label: "Cadastros", data: cadArr, color: "#38bdf8" }]} />
              </div>
            </div>

            {/* mês a mês */}
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <h2 className="text-sm font-semibold text-white/80 mb-2">Base ativa no fim de cada mês</h2>
                <AreaChart labels={monthly.map((m) => mesCurto(m.mes))} valueFmt={fmtInt} height={190}
                  series={[{ label: "Base ativa", data: monthly.map((m) => Number(m.base_fim)), color: "#a855f7" }]} />
              </div>
              <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-white/80">Novos × Renovadores por mês</h2>
                  <div className="flex items-center gap-3 text-[11px] text-white/50">
                    <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: "#38bdf8" }} />Novos</span>
                    <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full inline-block" style={{ background: "#34d399" }} />Renovadores</span>
                  </div>
                </div>
                <Bars labels={monthly.map((m) => mesCurto(m.mes))} data={monthly.map((m) => Number(m.novos))} color="#38bdf8" height={190}
                  compare={{ label: "Renovadores", data: monthly.map((m) => Number(m.renovadores)), color: "#34d399" }} />
              </div>
            </div>

            {/* funil */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <h2 className="text-sm font-semibold text-white/80 mb-1">Funil de lealdade</h2>
              <p className="text-xs text-white/45 mb-3">
                Cada degrau = meses distintos em que a pessoa renovou. Quanto mais alto o degrau, mais "grudado" o assinante — a % à direita é quem segue em dia (janela móvel de 30 dias).
              </p>
              <div className="space-y-1.5">
                {funnel.map((row) => {
                  const qtd = Number(row.qtd);
                  const pct = totalFunil ? (qtd / totalFunil) * 100 : 0;
                  const ref = funnelRet.find((r) => Number(r.faixa) === Number(row.faixa));
                  const taxa = ref && Number(ref.cohort) > 0 ? (Number(ref.retidos) / Number(ref.cohort)) * 100 : null;
                  return (
                    <div key={row.faixa} className="flex items-center gap-3 text-sm">
                      <div className="w-16 shrink-0 text-white/60 text-xs">{Number(row.faixa) === 0 ? "1º ciclo" : `${row.faixa}x`}</div>
                      <div className="flex-1 h-6 rounded-md bg-white/5 overflow-hidden relative">
                        <div className="h-full rounded-md" style={{
                          width: `${Math.max(2, pct)}%`,
                          background: `linear-gradient(90deg, rgba(168,85,247,${0.35 + 0.08 * Number(row.faixa)}), rgba(168,85,247,${0.6 + 0.06 * Number(row.faixa)}))`,
                        }} />
                        <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {fmtInt(qtd)} <span className="text-white/45 ml-1.5 font-normal">({pct.toFixed(1)}%)</span>
                        </span>
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {taxa != null ? (
                          <span className={taxa >= 60 ? "text-emerald-300" : taxa >= 40 ? "text-amber-300" : "text-rose-300"}>{taxa.toFixed(0)}% renova</span>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* projeção */}
            <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-white/5 border border-purple-400/20 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
                <h2 className="text-sm font-semibold text-white/90">Simulador de projeção — próximos 12 meses</h2>
                <div className="flex items-center gap-1.5">
                  {[["pessimista", "Pessimista"], ["atual", "Ritmo atual"], ["otimista", "Otimista"]].map(([k, l]) => (
                    <button key={k} onClick={() => setCenario(k)}
                      className={`px-2.5 py-1 rounded-md text-xs border ${
                        (k === "atual" && pNovos == null && pRet == null) ? "bg-purple-500/25 border-purple-400/40" : "bg-white/5 border-white/10 hover:bg-white/10"
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-white/45 mb-4">
                Modelo por COORTES: parte da composição real da base de hoje e cada leva desce o teu funil degrau a degrau ({(rateFor(0, adj) * 100).toFixed(0)}% no 1º ciclo, subindo até {(rateFor(4, adj) * 100).toFixed(0)}% nos veteranos) — a maturidade de quem fica já está dentro da conta. Entram {fmtInt(novos)} novos/mês; receita = base × ticket.
              </p>

              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <label className="block text-xs text-white/60">
                  Novos assinantes/mês: <span className="text-white font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtInt(novos)}</span>
                  <input type="range" min="100" max="3000" step="25" value={novos} onChange={(e) => setPNovos(Number(e.target.value))} className="w-full accent-sky-400 mt-1" />
                </label>
                <label className="block text-xs text-white/60">
                  Retenção (ajuste em todos os degraus): <span className="text-white font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{adj > 0 ? "+" : ""}{adj}pp</span>
                  <input type="range" min="-15" max="25" step="1" value={adj} onChange={(e) => setPRet(Number(e.target.value))} className="w-full accent-purple-400 mt-1" />
                </label>
                <label className="block text-xs text-white/60">
                  Ticket médio (R$/mês): <span className="text-white font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{ticket.toFixed(2).replace(".", ",")}</span>
                  <input type="range" min="10" max="50" step="0.5" value={ticket} onChange={(e) => setPTicket(Number(e.target.value))} className="w-full accent-emerald-400 mt-1" />
                </label>
              </div>

              {/* ✅ 20/08 — PONTO DE EQUILÍBRIO (pedido do Stefano) */}
              <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-4">
                <div className="text-xs font-semibold text-white/80 mb-2">🎯 Ponto de equilíbrio de entrada (reage ao slider de retenção)</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3" style={{ fontVariantNumeric: "tabular-nums" }}>
                  <div>
                    <div className="text-[11px] text-white/50 uppercase">Ritmo atual</div>
                    <div className="text-lg font-bold text-sky-300">{fmtInt(Number(kpis.novos_30d) || 0)}<span className="text-xs font-normal text-white/50">/mês</span></div>
                    <div className="text-[11px] text-white/45">≈ {Math.round((Number(kpis.novos_30d) || 0) / 30)}/dia</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/50 uppercase">Estancar a queda</div>
                    <div className="text-lg font-bold text-amber-300">{fmtInt(equil.estancar)}<span className="text-xs font-normal text-white/50">/mês</span></div>
                    <div className="text-[11px] text-white/45">≈ {Math.round(equil.estancar / 30)}/dia — empata com as saídas deste mês</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/50 uppercase">Segurar a base ({fmtInt(kpis.active_now)})</div>
                    <div className="text-lg font-bold text-emerald-300">{fmtInt(equil.segurar)}<span className="text-xs font-normal text-white/50">/mês</span></div>
                    <div className="text-[11px] text-white/45">≈ {Math.round(equil.segurar / 30)}/dia — acima disso a base CRESCE</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/50 uppercase">Multiplicador do funil</div>
                    <div className="text-lg font-bold text-purple-300">×{equil.mult.toFixed(2)}</div>
                    <div className="text-[11px] text-white/45">teto da base = novos × {equil.mult.toFixed(2)}</div>
                  </div>
                </div>
                {/* régua: ritmo atual vs marcos */}
                {(() => {
                  const pace = Number(kpis.novos_30d) || 0;
                  const escala = Math.max(equil.segurar * 1.25, pace * 1.1, 1);
                  const pct = (v) => `${Math.min(100, (v / escala) * 100)}%`;
                  return (
                    <div className="relative h-6 rounded-md bg-white/5 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-sky-500/40 rounded-md" style={{ width: pct(pace) }} />
                      <div className="absolute inset-y-0 w-0.5 bg-amber-400" style={{ left: pct(equil.estancar) }} title="estancar" />
                      <div className="absolute inset-y-0 w-0.5 bg-emerald-400" style={{ left: pct(equil.segurar) }} title="segurar/crescer" />
                      <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-white/70" style={{ fontVariantNumeric: "tabular-nums" }}>
                        você está aqui: {fmtInt(pace)} — faltam {fmtInt(Math.max(0, equil.segurar - pace))}/mês pra crescer
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-white/70 mb-1.5">Base de assinantes projetada</h3>
                  <AreaChart height={180}
                    labels={proj.meses.map((x) => (x.m === 0 ? "hoje" : `+${x.m}m`))}
                    valueFmt={fmtInt}
                    series={[{ label: "Base", data: proj.meses.map((x) => x.base), color: "#a855f7" }]} />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-white/70 mb-1.5">Receita mensal projetada</h3>
                  <AreaChart height={180}
                    labels={proj.meses.map((x) => (x.m === 0 ? "hoje" : `+${x.m}m`))}
                    valueFmt={fmtBRL}
                    series={[{ label: "Receita", data: proj.meses.map((x) => x.receita), color: "#34d399" }]} />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4" style={{ fontVariantNumeric: "tabular-nums" }}>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-[11px] text-white/50 uppercase">Em 3 meses</div>
                  <div className="text-lg font-bold">{fmtInt(proj.meses[3].base)}</div>
                  <div className="text-xs text-white/50">{fmtBRL(proj.meses[3].receita)}/mês</div>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-[11px] text-white/50 uppercase">Em 6 meses</div>
                  <div className="text-lg font-bold">{fmtInt(proj.meses[6].base)}</div>
                  <div className="text-xs text-white/50">{fmtBRL(proj.meses[6].receita)}/mês</div>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-[11px] text-white/50 uppercase">Em 12 meses</div>
                  <div className="text-lg font-bold">{fmtInt(proj.meses[12].base)}</div>
                  <div className="text-xs text-white/50">{fmtBRL(proj.meses[12].receita)}/mês</div>
                </div>
                <div className="rounded-xl bg-purple-500/10 border border-purple-400/25 p-3">
                  <div className="text-[11px] text-purple-200/70 uppercase">Receita acumulada 12m</div>
                  <div className="text-lg font-bold text-purple-100">{fmtBRL(proj.acumulado)}</div>
                  <div className="text-xs text-white/50">teto da base: {Number.isFinite(proj.equilibrio) ? fmtInt(proj.equilibrio) : "∞"}</div>
                </div>
              </div>

              <p className="text-xs text-white/40 mt-3" style={{ fontVariantNumeric: "tabular-nums" }}>
                🧬 Mistura da base — hoje: {totalFunil > 0 ? ((Number(funnel[0]?.qtd || 0) / totalFunil) * 100).toFixed(0) : 0}% no 1º ciclo, retenção média {(retGeral * 100).toFixed(0)}% → em +12m nesse cenário: {proj.pctNovataFim.toFixed(0)}% no 1º ciclo, retenção média {proj.retMediaFim.toFixed(0)}%. A base só "amadurece" de verdade quando a fatia de veteranos cresce — e quem alimenta os degraus de cima é a torneira de novos passando pelo gargalo do 1º ciclo.
              </p>
              <p className="text-xs text-white/40 mt-2">
                💡 "Teto da base" é onde a curva estaciona se nada mudar: o ponto em que os novos que entram empatam com o que o funil deixa escapar (simulado 60 meses à frente, coorte por coorte). Pra crescer o teto só tem dois botões de verdade — trazer mais gente por mês ou apertar os degraus do funil (o 1º ciclo é onde cada ponto vale mais).
              </p>
            </div>

            <div className="text-xs text-white/35 pb-6">
              Fontes: pix_payments (valor real InfinityPay/Asaas, sem venda avulsa) + Stripe estimado pelo preço da época · base ativa segue a mesma regra do acesso premium · renovações dedupadas por mês (retry de webhook/remigração/provider duplicado contam 1x). Atualizado {d.generated_at ? new Date(d.generated_at).toLocaleTimeString("pt-BR") : ""} — se atualiza sozinho a cada 1 min com a aba aberta.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
