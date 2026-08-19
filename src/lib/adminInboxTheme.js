// src/lib/adminInboxTheme.js
// ✅ 19/08 — TEMA ÚNICO dos 3 inboxes do admin (Suporte, Bot Vendas, Dora).
// As três páginas nasceram do mesmo esqueleto (Dora foi baseada no BotVendas)
// mas cada uma foi driftando de cor/borda/fundo — o Stefano reclamou que
// "cada página tem uma cara". Este objeto é espalhado NO FIM do `const S`
// de cada página (`...INBOX_BASE` por último = ele vence nas chaves comuns),
// então o visual estrutural é idêntico por construção e a LÓGICA de cada
// página fica intocada. Chaves específicas (listItem, badges de etapa,
// bolhas) continuam locais em cada página, usando INBOX_COLORS.
// Identidade: a mesma do AdminTabs/AdminHome novos (fundo #0e0e16, roxo
// #a855f7 como acento) — admin inteiro com UMA cara.

export const INBOX_COLORS = {
  bg: "#0e0e16",
  panel: "rgba(255,255,255,0.03)",
  panelStrong: "#15151f",
  border: "#26263a",
  borderSoft: "#1d1d2c",
  ink: "rgba(236,234,244,0.94)",
  inkSoft: "rgba(236,234,244,0.65)",
  accent: "#a855f7",
  accentSoft: "rgba(168,85,247,0.16)",
  accentBorder: "rgba(168,85,247,0.45)",
  accentInk: "#e4ccff",
  ok: "#2ecc71",
  warn: "#ff9f43",
  danger: "#ef4444",
};

const C = INBOX_COLORS;

export const INBOX_BASE = {
  page: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    background: C.bg,
    color: C.ink,
    position: "relative",
  },
  column: { display: "flex", flexDirection: "column", minWidth: 0, height: "100%" },
  panelHeader: {
    padding: 12,
    borderBottom: `1px solid ${C.border}`,
    background: C.panel,
  },
  headerTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: { fontWeight: 800 },
  subtitle: { fontSize: 12, opacity: 0.6, marginTop: 2 },
  actionsRow: { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" },
  btn: {
    padding: "8px 12px",
    borderRadius: 9,
    border: `1px solid ${C.border}`,
    background: "rgba(255,255,255,0.04)",
    color: C.ink,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
  },
  btnPrimary: {
    padding: "10px 16px",
    borderRadius: 10,
    border: `1px solid ${C.accentBorder}`,
    background: C.accentSoft,
    color: C.accentInk,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontWeight: 700,
    fontSize: 13.5,
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  error: { marginTop: 10, fontSize: 12, color: "#ff6b6b" },
  listWrap: { overflowY: "auto", flex: 1 },
  listTopRow: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
  name: { fontWeight: 700, letterSpacing: 0.2 },
  meta: { fontSize: 12, opacity: 0.7 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${C.border}`,
    background: C.accentSoft,
    fontSize: 15,
    fontWeight: 800,
    flex: "0 0 auto",
  },
  input: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: "rgba(255,255,255,0.04)",
    color: C.ink,
    outline: "none",
    minWidth: 0,
    fontSize: 13.5,
  },
  chatBody: { flex: 1, overflowY: "auto", padding: 12, background: C.bg },
  daySep: { display: "flex", justifyContent: "center", margin: "12px 0" },
  dayChip: {
    fontSize: 12,
    opacity: 0.85,
    padding: "4px 10px",
    borderRadius: 999,
    border: `1px solid ${C.border}`,
    background: C.panelStrong,
  },
  msgMetaRow: { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, alignItems: "center" },
  msgMeta: { fontSize: 11, opacity: 0.6 },
  composer: {
    padding: 12,
    borderTop: `1px solid ${C.border}`,
    display: "flex",
    gap: 8,
    background: C.panelStrong,
    alignItems: "center",
  },
  filterTabsRow: { display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" },
  filterTab: (active) => ({
    padding: "5px 12px",
    borderRadius: 999,
    border: active ? `1px solid ${C.accentBorder}` : `1px solid ${C.border}`,
    background: active ? C.accentSoft : "rgba(255,255,255,0.03)",
    color: active ? C.accentInk : C.inkSoft,
    fontSize: 12.5,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
};
