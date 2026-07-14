// src/components/AdminTabs.jsx
// Barra de navegação compartilhada entre as páginas /admin/* — antes cada
// painel era uma ilha isolada e só dava pra trocar de seção voltando pro
// site e abrindo o menu da navbar de novo (e o Bot de Vendas nem tinha link
// lá). Fica fixa no topo de cada painel admin.
import { useNavigate, useLocation } from "react-router-dom";

const TABS = [
  { path: "/admin/analytics", label: "Analytics" },
  { path: "/admin/users", label: "Usuários" },
  { path: "/admin/support", label: "Suporte" },
  { path: "/admin/bot-vendas", label: "Bot Vendas" },
  { path: "/admin/dora", label: "Dora" },
];

export default function AdminTabs() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        background: "#0b0b0b",
        borderBottom: "1px solid #2a2a2a",
        overflowX: "auto",
        flexShrink: 0,
      }}
    >
      {TABS.map((t) => {
        const active = location.pathname === t.path || location.pathname.startsWith(t.path + "/");
        return (
          <button
            key={t.path}
            onClick={() => navigate(t.path)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: active ? "1px solid rgba(46,204,113,0.5)" : "1px solid #2a2a2a",
              background: active ? "rgba(46,204,113,0.14)" : "rgba(255,255,255,0.03)",
              color: active ? "#86efac" : "rgba(255,255,255,0.65)",
              fontSize: 13,
              fontWeight: active ? 800 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
