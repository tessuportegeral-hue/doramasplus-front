// src/pages/AdminBotVendas.jsx
// Painel de monitoramento do BOT DE VENDAS (número 1499)
// Baseado em AdminSupport.jsx, adaptado para as tabelas:
//   - sales_bot_messages (id, phone, direction "in"/"out", message, created_at)
//   - sales_bot_sessions (phone, step, data jsonb {name,email,plan,order_nsu}, updated_at)
//   - pix_payments (source = 'whatsapp_sales_bot', status = 'paid')  -> ícone 💰
// Página somente leitura (monitoramento), com Realtime + polling de segurança.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// ===== Steps possíveis e seus badges =====
// 🟢 Verde = access_sent
// 🟡 Amarelo = waiting_payment
// 🔵 Azul = collect_info, collect_email
// ⚫ Cinza = start, choose_plan, support, support_detail
const STEP_META = {
  access_sent:    { label: "Acesso enviado",        color: "green",  emoji: "🟢" },
  waiting_payment:{ label: "Aguardando pagamento",  color: "yellow", emoji: "🟡" },
  collect_info:   { label: "Coletando dados",       color: "blue",   emoji: "🔵" },
  collect_email:  { label: "Coletando e-mail",      color: "blue",   emoji: "🔵" },
  start:          { label: "Início",                color: "gray",   emoji: "⚫" },
  choose_plan:    { label: "Escolhendo plano",      color: "gray",   emoji: "⚫" },
  support:        { label: "Suporte",               color: "gray",   emoji: "⚫" },
  support_detail: { label: "Suporte (detalhe)",     color: "gray",   emoji: "⚫" },
};

function stepMeta(step) {
  return STEP_META[step] || { label: step || "—", color: "gray", emoji: "⚫" };
}

const PAID_SOURCE = "whatsapp_sales_bot";
const POLL_MS = 15000; // ✅ polling de segurança (caso o realtime caia)

export default function AdminBotVendas() {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null); // sessão selecionada
  const [messages, setMessages] = useState([]);

  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all"); // all | green | yellow | blue | paid
  const [previews, setPreviews] = useState({}); // { [phone]: { message, direction, created_at } }
  const [unread, setUnread] = useState({}); // { [phone]: number }
  const [hasNewMsgs, setHasNewMsgs] = useState(false);
  const [paidOrderNsus, setPaidOrderNsus] = useState(() => new Set()); // order_nsu pagos

  // ✅ envio manual (humano) pelo número 1499
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // ✅ scroll
  const chatBodyRef = useRef(null);
  const messagesEndRef = useRef(null);

  // ✅ Realtime refs
  const msgChannelRef = useRef(null);
  const sessionChannelRef = useRef(null);
  const lastMessageIdRef = useRef(null);
  const selectedPhoneRef = useRef(null);

  // ✅ Responsivo sem Tailwind: detecta mobile via matchMedia
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 900px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    selectedPhoneRef.current = selected?.phone || null;
  }, [selected?.phone]);

  // ---------- helpers de scroll/leitura ----------
  function scrollToBottom(behavior = "auto") {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    }, 50);
  }

  function isNearBottom(threshold = 120) {
    const el = chatBodyRef.current;
    if (!el) return true;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    return remaining < threshold;
  }

  function storageKeyRead(phone) {
    return `admin_botvendas_last_read_${phone}`;
  }

  function markRead(phone) {
    try {
      localStorage.setItem(storageKeyRead(phone), String(Date.now()));
    } catch {}
    setUnread((prev) => ({ ...prev, [phone]: 0 }));
    setHasNewMsgs(false);
  }

  function playBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.05;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 120);
    } catch {}
  }

  // ---------- helpers de data/hora (pt-BR) ----------
  function toDate(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  function fmtTime(v) {
    const d = toDate(v);
    if (!d) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(d);
  }

  function dayKey(v) {
    const d = toDate(v);
    if (!d) return "unknown";
    const parts = new Intl.DateTimeFormat("pt-BR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).formatToParts(d);
    const dd = parts.find((p) => p.type === "day")?.value || "00";
    const mm = parts.find((p) => p.type === "month")?.value || "00";
    const yy = parts.find((p) => p.type === "year")?.value || "0000";
    return `${yy}-${mm}-${dd}`;
  }

  function dayLabel(v) {
    const d = toDate(v);
    if (!d) return "—";
    const now = new Date();
    const kMsg = dayKey(d);
    const kNow = dayKey(now);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const kYes = dayKey(yesterday);
    if (kMsg === kNow) return "Hoje";
    if (kMsg === kYes) return "Ontem";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    }).format(d);
  }

  function avatarTextFromPhone(phone) {
    const p = String(phone || "").replace(/\D/g, "");
    const last2 = p.slice(-2);
    return last2 ? `+${last2}` : "WA";
  }

  // ---------- helpers de sessão ----------
  function sessionData(s) {
    const d = s?.data;
    if (!d) return {};
    if (typeof d === "string") {
      try {
        return JSON.parse(d) || {};
      } catch {
        return {};
      }
    }
    return d;
  }

  function getDisplayTitle(s) {
    const d = sessionData(s);
    return d.name?.trim() || s?.phone || "";
  }

  function getDisplaySubtitle(s) {
    const d = sessionData(s);
    return d.name?.trim() ? s?.phone || "" : "";
  }

  function isPaid(s) {
    const d = sessionData(s);
    const nsu = d.order_nsu;
    return !!nsu && paidOrderNsus.has(String(nsu));
  }

  // ---------- carregamento ----------
  async function loadSessions() {
    try {
      setError("");
      setLoadingSessions(true);

      const { data, error } = await supabase
        .from("sales_bot_sessions")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("[BotVendas] loadSessions error:", error);
        setError(error.message || "Erro ao carregar sessões");
        setSessions([]);
        return;
      }

      setSessions(data || []);
    } catch (e) {
      console.error("[BotVendas] loadSessions exception:", e);
      setError(String(e?.message || e));
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }

  // últimas mensagens (para preview na lista, sem precisar abrir cada conversa)
  async function loadPreviews() {
    try {
      const { data, error } = await supabase
        .from("sales_bot_messages")
        .select("phone,direction,message,created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("[BotVendas] loadPreviews error:", error);
        return;
      }

      const map = {};
      for (const m of data || []) {
        // como vem desc, a primeira ocorrência de cada phone é a mais recente
        if (!map[m.phone]) {
          map[m.phone] = {
            message: m.message,
            direction: m.direction,
            created_at: m.created_at,
          };
        }
      }
      setPreviews(map);
    } catch (e) {
      console.error("[BotVendas] loadPreviews exception:", e);
    }
  }

  // pix_payments pagos via bot de vendas -> set de order_nsu
  async function loadPaid() {
    try {
      const { data, error } = await supabase
        .from("pix_payments")
        .select("order_nsu")
        .eq("source", PAID_SOURCE)
        .eq("status", "paid");

      if (error) {
        console.error("[BotVendas] loadPaid error:", error);
        return;
      }

      const set = new Set();
      for (const row of data || []) {
        if (row.order_nsu) set.add(String(row.order_nsu));
      }
      setPaidOrderNsus(set);
    } catch (e) {
      console.error("[BotVendas] loadPaid exception:", e);
    }
  }

  function refreshAll() {
    loadSessions();
    loadPreviews();
    loadPaid();
  }

  async function loadMessages(phone, opts = {}) {
    const { scroll = true, behavior = "auto" } = opts;
    try {
      setError("");
      setLoadingMsgs(true);

      const { data, error } = await supabase
        .from("sales_bot_messages")
        .select("*")
        .eq("phone", phone)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[BotVendas] loadMessages error:", error);
        setError(error.message || "Erro ao carregar mensagens");
        setMessages([]);
        return;
      }

      const rows = data || [];
      setMessages(rows);

      const last = rows[rows.length - 1];
      if (last) {
        setPreviews((prev) => ({
          ...prev,
          [phone]: {
            message: last.message,
            direction: last.direction,
            created_at: last.created_at,
          },
        }));
      }

      markRead(phone);
      if (scroll) scrollToBottom(behavior);
    } catch (e) {
      console.error("[BotVendas] loadMessages exception:", e);
      setError(String(e?.message || e));
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  }

  function openChat(s) {
    setSelected(s);
    setHasNewMsgs(false);
    setText("");
    loadMessages(s.phone, { scroll: true, behavior: "auto" });
  }

  // ✅ envia mensagem manual pelo bot de vendas (número 1499)
  // Usa o endpoint /send-manual da edge function whatsapp-sales-bot,
  // que reaproveita as credenciais do WhatsApp e salva como direction "out".
  async function sendMessage() {
    if (!selected) return;
    const msg = text.trim();
    if (!msg) return;

    try {
      setSending(true);
      setError("");

      const { data, error } = await supabase.functions.invoke(
        "whatsapp-sales-bot/send-manual",
        { body: { phone: selected.phone, text: msg } }
      );

      if (error) {
        console.error("[BotVendas] sendMessage invoke error:", error);
        setError(error.message || "Erro ao enviar mensagem");
        return;
      }
      if (!data?.ok) {
        setError(data?.error || "Falha ao enviar mensagem");
        return;
      }

      setText("");

      // otimista: já mostra no chat (o realtime também vai trazer o insert)
      const optimistic = {
        id: `local-${selected.phone}-${messages.length}`,
        phone: selected.phone,
        direction: "out",
        message: msg,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => (prev ? [...prev, optimistic] : [optimistic]));
      setPreviews((prev) => ({
        ...prev,
        [selected.phone]: { message: msg, direction: "out", created_at: optimistic.created_at },
      }));
      scrollToBottom("smooth");

      // sincroniza com o banco logo em seguida
      loadMessages(selected.phone, { scroll: true, behavior: "smooth" });
    } catch (e) {
      console.error("[BotVendas] sendMessage exception:", e);
      setError(String(e?.message || e));
    } finally {
      setSending(false);
    }
  }

  // ---------- efeitos ----------
  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ polling de segurança (atualiza lista, previews e pagos)
  useEffect(() => {
    const id = setInterval(() => {
      loadSessions();
      loadPreviews();
      loadPaid();
    }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    lastMessageIdRef.current = messages?.[messages.length - 1]?.id || null;
  }, [messages]);

  // ✅ Realtime: novas mensagens (qualquer phone) — atualiza preview/chat aberto
  useEffect(() => {
    if (msgChannelRef.current) {
      try {
        supabase.removeChannel(msgChannelRef.current);
      } catch {}
      msgChannelRef.current = null;
    }

    const channel = supabase
      .channel("admin-botvendas-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sales_bot_messages" },
        (payload) => {
          const newMsg = payload?.new;
          if (!newMsg?.id) return;

          const phone = newMsg.phone;

          setPreviews((prev) => ({
            ...prev,
            [phone]: {
              message: newMsg.message,
              direction: newMsg.direction,
              created_at: newMsg.created_at,
            },
          }));

          const isThisChatOpen = selectedPhoneRef.current === phone;

          if (isThisChatOpen) {
            if (newMsg.id === lastMessageIdRef.current) return;
            setMessages((prev) => {
              if (!prev) return [newMsg];
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            if (newMsg.direction === "out" || isNearBottom()) {
              scrollToBottom("smooth");
              markRead(phone);
            } else {
              setHasNewMsgs(true);
            }

            if (newMsg.direction === "in" && !isNearBottom()) {
              setUnread((prev) => ({ ...prev, [phone]: (prev[phone] || 0) + 1 }));
              playBeep();
            }
          } else if (newMsg.direction === "in") {
            setUnread((prev) => ({ ...prev, [phone]: (prev[phone] || 0) + 1 }));
            playBeep();
          }
        }
      )
      .subscribe();

    msgChannelRef.current = channel;

    return () => {
      if (msgChannelRef.current) {
        try {
          supabase.removeChannel(msgChannelRef.current);
        } catch {}
        msgChannelRef.current = null;
      }
    };
  }, []);

  // ✅ Realtime: mudanças nas sessões (step/data) — recarrega a lista
  useEffect(() => {
    if (sessionChannelRef.current) {
      try {
        supabase.removeChannel(sessionChannelRef.current);
      } catch {}
      sessionChannelRef.current = null;
    }

    const channel = supabase
      .channel("admin-botvendas-sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_bot_sessions" },
        () => {
          loadSessions();
          loadPaid();
        }
      )
      .subscribe();

    sessionChannelRef.current = channel;

    return () => {
      if (sessionChannelRef.current) {
        try {
          supabase.removeChannel(sessionChannelRef.current);
        } catch {}
        sessionChannelRef.current = null;
      }
    };
  }, []);

  // ===== Estilos (só UI) =====
  const S = {
    page: {
      display: "flex",
      height: "100dvh",
      background: "#0b0b0b",
      color: "rgba(255,255,255,0.92)",
      position: "relative",
    },
    column: { display: "flex", flexDirection: "column", minWidth: 0, height: "100%" },
    panelHeader: {
      padding: 12,
      borderBottom: "1px solid #2a2a2a",
      background: "rgba(255,255,255,0.02)",
    },
    headerTitleRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    title: { fontWeight: 800 },
    subtitle: { fontSize: 12, opacity: 0.7, marginTop: 2 },
    actionsRow: { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" },
    btn: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid #2a2a2a",
      background: "rgba(255,255,255,0.04)",
      color: "rgba(255,255,255,0.92)",
      cursor: "pointer",
    },
    error: { marginTop: 10, fontSize: 12, color: "#ff6b6b" },

    listWrap: { overflowY: "auto", flex: 1 },
    listItem: (active, hasUnread) => ({
      padding: 12,
      paddingLeft: hasUnread && !active ? 10 : 12,
      borderBottom: "1px solid #1f1f1f",
      borderLeft: hasUnread && !active ? "3px solid #ef4444" : "3px solid transparent",
      cursor: "pointer",
      background: active
        ? "rgba(255,255,255,0.06)"
        : hasUnread
        ? "rgba(239,68,68,0.05)"
        : "transparent",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }),
    listTopRow: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
    name: { fontWeight: 800, letterSpacing: 0.2 },
    stepBadge: (color) => {
      const palette = {
        green: { bg: "rgba(34,197,94,0.12)", bd: "rgba(34,197,94,0.4)", fg: "#86efac" },
        yellow: { bg: "rgba(234,179,8,0.12)", bd: "rgba(234,179,8,0.4)", fg: "#fde68a" },
        blue: { bg: "rgba(59,130,246,0.12)", bd: "rgba(59,130,246,0.4)", fg: "#93c5fd" },
        gray: { bg: "rgba(255,255,255,0.05)", bd: "rgba(255,255,255,0.14)", fg: "rgba(255,255,255,0.7)" },
      };
      const p = palette[color] || palette.gray;
      return {
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${p.bd}`,
        background: p.bg,
        color: p.fg,
        whiteSpace: "nowrap",
        fontWeight: 700,
      };
    },
    unreadBadge: {
      minWidth: 18,
      height: 18,
      borderRadius: 999,
      background: "#ef4444",
      color: "#fff",
      fontSize: 11,
      fontWeight: 800,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 5px",
      flexShrink: 0,
    },
    filterTabsRow: { display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" },
    filterTab: (active) => ({
      padding: "5px 12px",
      borderRadius: 999,
      border: active ? "1px solid rgba(255,255,255,0.28)" : "1px solid #2a2a2a",
      background: active ? "rgba(255,255,255,0.10)" : "transparent",
      color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: active ? 700 : 400,
    }),
    meta: { fontSize: 12, opacity: 0.75 },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: 999,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.06)",
      fontSize: 12,
      fontWeight: 800,
      flex: "0 0 auto",
    },
    infoChips: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 },
    infoChip: {
      fontSize: 11,
      padding: "2px 8px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.04)",
      opacity: 0.9,
    },

    chatBody: { flex: 1, overflowY: "auto", padding: 12 },
    daySep: { display: "flex", justifyContent: "center", margin: "12px 0" },
    dayChip: {
      fontSize: 12,
      opacity: 0.85,
      padding: "4px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.05)",
    },
    msgRow: (dir) => ({
      display: "flex",
      justifyContent: dir === "out" ? "flex-end" : "flex-start",
      marginBottom: 10,
    }),
    bubble: (dir) => ({
      maxWidth: "86%",
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.10)",
      background: dir === "out" ? "rgba(70,130,255,0.12)" : "rgba(255,255,255,0.05)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      lineHeight: 1.35,
    }),
    msgMetaRow: {
      display: "flex",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 6,
      alignItems: "center",
    },
    msgMeta: { fontSize: 11, opacity: 0.65 },
    input: {
      flex: 1,
      padding: 10,
      borderRadius: 12,
      border: "1px solid #2a2a2a",
      background: "rgba(255,255,255,0.04)",
      color: "rgba(255,255,255,0.92)",
      outline: "none",
      minWidth: 0,
    },
    detailRow: { fontSize: 12, opacity: 0.85, marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" },
    link: { color: "#93c5fd", wordBreak: "break-all" },
    composer: {
      padding: 12,
      borderTop: "1px solid #2a2a2a",
      display: "flex",
      gap: 8,
      background: "rgba(0,0,0,0.35)",
      alignItems: "center",
    },
    btnPrimary: {
      padding: "10px 14px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(70,130,255,0.18)",
      color: "rgba(255,255,255,0.95)",
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    btnDisabled: { opacity: 0.55, cursor: "not-allowed" },
  };

  // ---------- derivações ----------
  const totalUnread = useMemo(
    () => sessions.filter((s) => (unread[s.phone] || 0) > 0).length,
    [sessions, unread]
  );

  const paidCount = useMemo(
    () => sessions.filter((s) => isPaid(s)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, paidOrderNsus]
  );

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions
      .filter((s) => {
        const d = sessionData(s);
        if (q) {
          const hay = [s.phone, d.name, d.email, d.order_nsu, d.plan]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (activeFilter === "paid") return isPaid(s);
        if (["green", "yellow", "blue", "gray"].includes(activeFilter)) {
          return stepMeta(s.step).color === activeFilter;
        }
        return true;
      })
      .sort((a, b) => {
        const aU = (unread[a.phone] || 0) > 0 ? 1 : 0;
        const bU = (unread[b.phone] || 0) > 0 ? 1 : 0;
        return bU - aU; // não lidos sobem ao topo; mantém ordem do DB nos demais
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, search, activeFilter, unread, paidOrderNsus]);

  function renderMessageBody(m) {
    const text = String(m?.message || "");
    // Linkifica URLs simples (acesso enviado, etc.)
    const parts = text.split(/(https?:\/\/\S+)/g);
    return (
      <div>
        {parts.map((p, i) =>
          /^https?:\/\//i.test(p) ? (
            <a key={i} href={p} target="_blank" rel="noreferrer" style={S.link}>
              {p}
            </a>
          ) : (
            <React.Fragment key={i}>{p}</React.Fragment>
          )
        )}
      </div>
    );
  }

  // ---------- painéis ----------
  const ListPanel = (
    <div
      style={{
        ...S.column,
        width: isMobile ? "100%" : 360,
        borderRight: isMobile ? "none" : "1px solid #2a2a2a",
      }}
    >
      <div style={S.panelHeader}>
        <div style={S.headerTitleRow}>
          <div>
            <div style={S.title}>Bot de Vendas (1499)</div>
            <div style={S.subtitle}>/admin/bot-vendas</div>
          </div>
          {isMobile && selected ? (
            <button onClick={() => setSelected(null)} style={S.btn} title="Voltar">
              ←
            </button>
          ) : null}
        </div>

        <div style={S.actionsRow}>
          <button onClick={refreshAll} style={S.btn}>
            Atualizar
          </button>
          <span style={{ ...S.meta, alignSelf: "center" }}>
            {sessions.length} sessões • 💰 {paidCount} pagas
          </span>
        </div>

        <div style={S.filterTabsRow}>
          {[
            { key: "all", label: "Todos" },
            { key: "green", label: "🟢 Acesso" },
            { key: "yellow", label: "🟡 Pagamento" },
            { key: "blue", label: "🔵 Coleta" },
            { key: "gray", label: "⚫ Outros" },
            { key: "paid", label: paidCount > 0 ? `💰 Pagos (${paidCount})` : "💰 Pagos" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              style={S.filterTab(activeFilter === key)}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número, nome, e-mail ou NSU…"
          style={{ ...S.input, marginTop: 10 }}
        />

        {totalUnread > 0 ? (
          <div style={{ ...S.meta, marginTop: 8 }}>{totalUnread} conversa(s) não lida(s)</div>
        ) : null}

        {error ? <div style={S.error}>{error}</div> : null}
      </div>

      <div style={S.listWrap}>
        {loadingSessions ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Carregando sessões…</div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma sessão ainda.</div>
        ) : filteredSessions.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma sessão neste filtro.</div>
        ) : (
          filteredSessions.map((s) => {
            const active = selected?.phone === s.phone;
            const meta = stepMeta(s.step);
            const prev = previews[s.phone];
            const unreadCount = unread[s.phone] || 0;
            const title = getDisplayTitle(s);
            const subtitle = getDisplaySubtitle(s);
            const d = sessionData(s);
            const paid = isPaid(s);

            return (
              <div key={s.phone} onClick={() => openChat(s)} style={S.listItem(active, unreadCount > 0)}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={S.avatar}>{avatarTextFromPhone(s.phone)}</div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.listTopRow}>
                      <div style={{ ...S.name, fontWeight: unreadCount > 0 ? 900 : 700, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {paid ? <span title="Compra paga">💰</span> : null}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {title}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        {unreadCount > 0 ? <div style={S.unreadBadge}>{unreadCount}</div> : null}
                        <div style={S.stepBadge(meta.color)} title={s.step || ""}>
                          {meta.emoji} {meta.label}
                        </div>
                      </div>
                    </div>

                    <div style={{ ...S.meta, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
                      {subtitle ? <span style={{ opacity: 0.85 }}>{subtitle}</span> : null}
                      {prev?.created_at ? (
                        <span style={{ opacity: 0.7 }}>• {fmtTime(prev.created_at)}</span>
                      ) : s.updated_at ? (
                        <span style={{ opacity: 0.7 }}>• {fmtTime(s.updated_at)}</span>
                      ) : null}
                    </div>

                    {(d.plan || d.email) ? (
                      <div style={S.infoChips}>
                        {d.plan ? <span style={S.infoChip}>plano: {d.plan}</span> : null}
                        {d.email ? <span style={S.infoChip}>{d.email}</span> : null}
                      </div>
                    ) : null}

                    {prev?.message ? (
                      <div
                        style={{
                          fontSize: 12,
                          opacity: unreadCount > 0 ? 0.9 : 0.65,
                          fontWeight: unreadCount > 0 ? 600 : 400,
                          marginTop: 3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {prev.direction === "in" ? "👤 " : "🤖 "}
                        {prev.message}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const ChatPanel = (
    <div style={{ ...S.column, flex: 1 }}>
      <div style={S.panelHeader}>
        {selected ? (
          <div style={S.headerTitleRow}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={S.avatar}>{avatarTextFromPhone(selected.phone)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 6 }}>
                  {isPaid(selected) ? <span title="Compra paga">💰</span> : null}
                  {getDisplayTitle(selected)}
                </div>
                {getDisplaySubtitle(selected) ? (
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                    {getDisplaySubtitle(selected)}
                  </div>
                ) : null}
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  step:{" "}
                  <b>
                    {stepMeta(selected.step).emoji} {selected.step || "—"}
                  </b>
                </div>
                {(() => {
                  const d = sessionData(selected);
                  return (
                    <div style={S.detailRow}>
                      {d.email ? <span style={S.infoChip}>✉️ {d.email}</span> : null}
                      {d.plan ? <span style={S.infoChip}>📦 {d.plan}</span> : null}
                      {d.order_nsu ? <span style={S.infoChip}>NSU: {d.order_nsu}</span> : null}
                    </div>
                  );
                })()}
              </div>
            </div>

            {isMobile ? (
              <button onClick={() => setSelected(null)} style={S.btn}>
                ← Voltar
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ opacity: 0.8 }}>Selecione uma conversa para monitorar.</div>
        )}
      </div>

      <div
        ref={chatBodyRef}
        style={S.chatBody}
        onScroll={() => {
          if (isNearBottom()) setHasNewMsgs(false);
        }}
      >
        {!selected ? null : loadingMsgs ? (
          <div style={{ opacity: 0.8 }}>Carregando mensagens…</div>
        ) : messages.length === 0 ? (
          <div style={{ opacity: 0.8 }}>Sem mensagens nessa conversa.</div>
        ) : (
          <>
            {(() => {
              let lastDay = null;
              return messages.map((m) => {
                const created = m.created_at || null;
                const k = dayKey(created);
                const showDay = k !== lastDay;
                lastDay = k;

                return (
                  <React.Fragment key={m.id}>
                    {showDay ? (
                      <div style={S.daySep}>
                        <div style={S.dayChip}>{dayLabel(created)}</div>
                      </div>
                    ) : null}

                    <div style={S.msgRow(m.direction)}>
                      <div style={S.bubble(m.direction)}>
                        <div style={S.msgMetaRow}>
                          <div style={S.msgMeta}>{m.direction === "in" ? "👤 Pessoa" : "🤖 Bot"}</div>
                          <div style={S.msgMeta}>{fmtTime(created)}</div>
                        </div>
                        {renderMessageBody(m)}
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}

            {hasNewMsgs ? (
              <button
                onClick={() => {
                  scrollToBottom("smooth");
                  if (selected?.phone) markRead(selected.phone);
                }}
                style={{
                  position: "sticky",
                  bottom: 12,
                  marginTop: 8,
                  ...S.btn,
                  alignSelf: "center",
                }}
              >
                Novas mensagens ↓
              </button>
            ) : null}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {selected ? (
        <div style={S.composer}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Responder como humano (pelo número 1499)…"
            style={S.input}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            disabled={sending}
          />
          <button
            onClick={sendMessage}
            disabled={sending || !text.trim()}
            style={{ ...S.btnPrimary, ...(sending || !text.trim() ? S.btnDisabled : null) }}
          >
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      ) : null}
    </div>
  );

  // ===== Layout responsivo =====
  return (
    <div style={S.page}>
      {isMobile ? (selected ? ChatPanel : ListPanel) : (
        <>
          {ListPanel}
          {ChatPanel}
        </>
      )}
    </div>
  );
}
