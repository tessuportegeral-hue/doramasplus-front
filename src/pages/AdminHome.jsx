// src/pages/AdminHome.jsx
// ✅ 19/08 — HOME do admin (/admin), parte da reorganização pedida pelo
// Stefano ("tá muito bagunçado"). Antes /admin redirecionava direto pro
// Analytics; agora abre uma visão geral do DIA: 4 números essenciais,
// pendências que precisam de gente (Dora, catálogo, pix sem acesso) e
// atalhos. Tudo vem de UMA chamada na edge function admin-analytics
// (v30 devolve signups/home/mrr prontos) — zero query nova no front.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet";
import {
  Users,
  CreditCard,
  BarChart3,
  Sparkles,
  Clapperboard,
  AlertTriangle,
  CheckCircle2,
  MessageCircle,
  Bot,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/lib/customSupabaseClient";
import AdminTabs from "@/components/AdminTabs";

const fmtBRL = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtN = (v) => (Number(v) || 0).toLocaleString("pt-BR");

export default function AdminHome() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [d, setD] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // período = hoje (BRT) só pra "vendas de hoje"; o resto (ativos, MRR,
      // signups, home) independe do período.
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const { data, error: err } = await supabase.functions.invoke("admin-analytics", {
        body: { period_start: start.toISOString(), period_end: now.toISOString() },
      });
      if (err) throw new Error(err.message);
      setD(data);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const alerts = [];
  if (d?.home) {
    if (d.home.dora_pendentes > 0)
      alerts.push({
        icon: Sparkles,
        text: `${d.home.dora_pendentes} conversa${d.home.dora_pendentes > 1 ? "s" : ""} da Dora precisando de humano`,
        to: "/admin/dora",
      });
    if (d.home.catalogo_quebrado > 0)
      alerts.push({
        icon: Clapperboard,
        text: `${d.home.catalogo_quebrado} dorama${d.home.catalogo_quebrado > 1 ? "s" : ""} recém-subido${d.home.catalogo_quebrado > 1 ? "s" : ""} com título/capa quebrado`,
        to: "/admin/doramas",
      });
    if (d.home.pix_sem_acesso_24h > 0)
      alerts.push({
        icon: AlertTriangle,
        text: `${d.home.pix_sem_acesso_24h} Pix pago nas últimas 24h SEM acesso liberado`,
        to: "/admin/users",
      });
  }

  const S = {
    page: {
      minHeight: "100vh",
      background: "#101018",
      color: "#e9e6f7",
      display: "flex",
      flexDirection: "column",
    },
    wrap: { maxWidth: 1060, width: "100%", margin: "0 auto", padding: "28px 20px 60px" },
    h1: { fontSize: 24, fontWeight: 800, margin: 0 },
    sub: { color: "rgba(233,230,247,0.55)", fontSize: 14, margin: "4px 0 24px" },
    sec: {
      fontSize: 12.5,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "rgba(233,230,247,0.45)",
      margin: "28px 0 12px",
    },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 },
    card: {
      background: "#15151f",
      border: "1px solid #26263a",
      borderRadius: 12,
      padding: "16px 18px",
    },
    label: {
      fontSize: 12.5,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      color: "rgba(233,230,247,0.45)",
      fontWeight: 600,
      display: "flex",
      alignItems: "center",
      gap: 8,
    },
    num: { fontSize: 28, fontWeight: 800, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" },
    det: { fontSize: 13, color: "rgba(233,230,247,0.55)" },
    alert: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      background: "rgba(239,68,68,0.08)",
      border: "1px solid rgba(239,68,68,0.35)",
      borderRadius: 12,
      padding: "13px 16px",
      cursor: "pointer",
      color: "#fecaca",
      fontSize: 14,
      width: "100%",
      textAlign: "left",
    },
    ok: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      background: "rgba(52,211,153,0.07)",
      border: "1px solid rgba(52,211,153,0.3)",
      borderRadius: 12,
      padding: "13px 16px",
      color: "#a7f3d0",
      fontSize: 14,
    },
    shortcut: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: "#15151f",
      border: "1px solid #26263a",
      borderRadius: 12,
      padding: "14px 16px",
      cursor: "pointer",
      color: "#e9e6f7",
      fontSize: 14,
      fontWeight: 600,
      width: "100%",
      textAlign: "left",
    },
    refresh: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "rgba(168,85,247,0.12)",
      border: "1px solid rgba(168,85,247,0.4)",
      color: "#e4ccff",
      borderRadius: 9,
      padding: "8px 14px",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
    },
  };

  return (
    <div style={S.page}>
      <Helmet>
        <title>Admin | DoramasPlus</title>
      </Helmet>
      <AdminTabs />
      <div style={S.wrap}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={S.h1}>Visão geral</h1>
            <p style={S.sub}>O dia de hoje num olhar — números detalhados ficam no Analytics.</p>
          </div>
          <button style={S.refresh} onClick={load} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Atualizar
          </button>
        </div>

        {error ? (
          <div style={{ ...S.alert, cursor: "default" }}>
            <AlertTriangle size={18} /> Falha ao carregar: {error}
          </div>
        ) : null}

        <div style={S.sec}>Precisa de você</div>
        {loading && !d ? (
          <div style={{ ...S.det, display: "flex", alignItems: "center", gap: 8 }}>
            <Loader2 size={15} className="animate-spin" /> Carregando…
          </div>
        ) : alerts.length === 0 ? (
          <div style={S.ok}>
            <CheckCircle2 size={18} /> Nada pendente agora — Dora, catálogo e pagamentos em dia.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a, i) => {
              const Icon = a.icon;
              return (
                <button key={i} style={S.alert} onClick={() => navigate(a.to)}>
                  <Icon size={18} style={{ flexShrink: 0 }} /> {a.text}
                  <span style={{ marginLeft: "auto", opacity: 0.7, fontSize: 13 }}>resolver →</span>
                </button>
              );
            })}
          </div>
        )}

        <div style={S.sec}>Hoje</div>
        <div style={S.grid}>
          <div style={S.card}>
            <div style={S.label}><Users size={14} /> Cadastros hoje</div>
            <div style={S.num}>{fmtN(d?.signups?.today?.signups)}</div>
            <div style={S.det}>
              Pagaram: {fmtN(d?.signups?.today?.paid)} ({d?.signups?.today?.conversion_rate ?? 0}%) · ontem:{" "}
              {fmtN(d?.signups?.yesterday?.signups)}
            </div>
          </div>
          <div style={S.card}>
            <div style={S.label}><CreditCard size={14} /> Faturamento hoje</div>
            <div style={S.num}>{fmtBRL(d?.revenue_period)}</div>
            <div style={S.det}>{fmtN(d?.sold_total)} venda{(d?.sold_total || 0) === 1 ? "" : "s"} (Pix + Stripe + manual)</div>
          </div>
          <div style={S.card}>
            <div style={S.label}><Users size={14} /> Assinantes ativos</div>
            <div style={S.num}>{fmtN(d?.active_now)}</div>
            <div style={S.det}>
              {fmtN(d?.active_now_monthly)} mensal · {fmtN(d?.active_now_quarterly)} trimestral
            </div>
          </div>
          <div style={S.card}>
            <div style={S.label}><BarChart3 size={14} /> MRR</div>
            <div style={S.num}>{fmtBRL(d?.mrr?.total)}</div>
            <div style={S.det}>preço vigente + {fmtN(d?.mrr?.stripe_actives)} legado Stripe no preço antigo</div>
          </div>
        </div>

        <div style={S.sec}>Ir direto para</div>
        <div style={S.grid}>
          <button style={S.shortcut} onClick={() => navigate("/admin/analytics")}>
            <BarChart3 size={17} /> Analytics completo
          </button>
          <button style={S.shortcut} onClick={() => navigate("/admin/support")}>
            <MessageCircle size={17} /> Suporte WhatsApp
          </button>
          <button style={S.shortcut} onClick={() => navigate("/admin/bot-vendas")}>
            <Bot size={17} /> Bot de Vendas
          </button>
          <button style={S.shortcut} onClick={() => navigate("/admin/doramas")}>
            <Clapperboard size={17} /> Gerenciar Doramas
          </button>
        </div>
      </div>
    </div>
  );
}
