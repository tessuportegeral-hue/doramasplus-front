// src/components/AdminTabs.jsx
// Barra de navegação compartilhada entre as páginas /admin/*.
// ✅ 19/08 (reorganização do admin, pedido do Stefano — "tá muito bagunçado"):
// - Itens AGRUPADOS por assunto (Visão | Pessoas/Conteúdo | Conversas | Ferramentas)
//   com separadores, ícone em tudo e visual único pra todas as páginas.
// - Entradas que FALTAVAM: Início (home nova do admin) e Doramas (existia a
//   página, mas não tinha como chegar nela pela barra).
// - Badge vermelho na Dora com quantas conversas estão "precisa de humano"
//   (poll de 60s direto na tabela — o admin tem RLS de leitura, mesma query
//   do painel da Dora). Antes isso ficava invisível até abrir a aba.
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home,
  BarChart3,
  Activity,
  Users,
  Clapperboard,
  MessageCircle,
  Bot,
  Sparkles,
  Bell,
  MonitorPlay,
  Inbox,
} from "lucide-react";
import { supabase } from "@/lib/customSupabaseClient";

const GROUPS = [
  {
    items: [
      { path: "/admin", label: "Início", icon: Home, exact: true },
      { path: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { path: "/admin/pulso", label: "Pulso", icon: Activity },
    ],
  },
  {
    items: [
      { path: "/admin/users", label: "Usuários", icon: Users },
      { path: "/admin/doramas", label: "Doramas", icon: Clapperboard },
      { path: "/admin/pedidos", label: "Pedidos", icon: Inbox },
    ],
  },
  {
    items: [
      { path: "/admin/support", label: "Suporte", icon: MessageCircle },
      { path: "/admin/bot-vendas", label: "Bot Vendas", icon: Bot },
      { path: "/admin/dora", label: "Dora", icon: Sparkles, badge: "dora" },
    ],
  },
  {
    items: [
      { path: "/admin/push", label: "Push", icon: Bell },
      { path: "/admin/espelho", label: "Espelho", icon: MonitorPlay },
    ],
  },
];

export default function AdminTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const [doraPendentes, setDoraPendentes] = useState(0);
  // ✅ 19/08 (celular): com 9 itens + rótulos a barra ficava com quilômetros
  // de scroll lateral no telefone. Abaixo de 640px vira SÓ ÍCONE (rótulo
  // some, badge fica) — cabe quase tudo na tela sem rolar.
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 640px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setCompact(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await supabase
          .from("dora_conversations")
          .select("session_id")
          .eq("needs_human", true)
          .eq("role", "assistant")
          .limit(500);
        if (alive) setDoraPendentes(new Set((data || []).map((r) => r.session_id)).size);
      } catch {
        /* badge é bônus — nunca quebra a barra */
      }
    };
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const S = {
    bar: {
      display: "flex",
      alignItems: "center",
      gap: compact ? 2 : 4,
      padding: compact ? "8px 8px" : "8px 14px",
      background: "#0e0e16",
      borderBottom: "1px solid #26263a",
      overflowX: "auto",
      flexShrink: 0,
      fontFamily: "inherit",
    },
    brand: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      paddingRight: compact ? 6 : 14,
      color: "#e9e6f7",
      fontWeight: 800,
      fontSize: 14,
      whiteSpace: "nowrap",
      flexShrink: 0,
      cursor: "pointer",
      background: "none",
      border: "none",
    },
    brandDot: {
      width: 8,
      height: 8,
      borderRadius: 99,
      background: "#a855f7",
      boxShadow: "0 0 8px rgba(168,85,247,.8)",
    },
    sep: {
      width: 1,
      height: 22,
      background: "#26263a",
      margin: compact ? "0 3px" : "0 8px",
      flexShrink: 0,
    },
    item: (active) => ({
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      padding: compact ? "8px 9px" : "7px 12px",
      borderRadius: 9,
      border: "1px solid transparent",
      background: active ? "rgba(168,85,247,0.16)" : "transparent",
      borderColor: active ? "rgba(168,85,247,0.45)" : "transparent",
      color: active ? "#e4ccff" : "rgba(233,230,247,0.62)",
      fontSize: 13,
      fontWeight: active ? 700 : 500,
      cursor: "pointer",
      whiteSpace: "nowrap",
      flexShrink: 0,
    }),
    badge: {
      minWidth: 17,
      height: 17,
      padding: "0 4px",
      borderRadius: 99,
      background: "#ef4444",
      color: "#fff",
      fontSize: 10.5,
      fontWeight: 800,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      lineHeight: 1,
    },
  };

  return (
    <div style={S.bar}>
      <button style={S.brand} onClick={() => navigate("/admin")} title="Início do admin">
        <span style={S.brandDot} />
        {compact ? null : "Admin"}
      </button>
      {GROUPS.map((g, gi) => (
        <div key={gi} style={{ display: "contents" }}>
          <div style={S.sep} />
          {g.items.map((t) => {
            const active = t.exact
              ? location.pathname === t.path
              : location.pathname === t.path || location.pathname.startsWith(t.path + "/");
            const Icon = t.icon;
            const badgeN = t.badge === "dora" ? doraPendentes : 0;
            return (
              <button key={t.path} onClick={() => navigate(t.path)} style={S.item(active)} title={t.label}>
                <Icon size={compact ? 17 : 15} strokeWidth={2.2} />
                {compact ? null : t.label}
                {badgeN > 0 ? <span style={S.badge}>{badgeN > 99 ? "99+" : badgeN}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
