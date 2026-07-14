// src/pages/AdminDora.jsx
// Painel de monitoramento + resposta da DORA (chatbot flutuante do site).
// Baseado em AdminBotVendas.jsx, adaptado pra tabela:
//   - dora_conversations (id, session_id, user_id, role "user"/"assistant"/"admin", content, created_at)
// Não existe uma tabela de "sessões" separada — cada session_id (gerado no
// navegador do visitante a cada carregamento de página) agrupa as mensagens.
// Responder aqui grava role="admin"; o widget (DoramasChat.jsx) faz polling
// nessas linhas e mostra pro visitante como "Atendimento DoramasPlus".
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const POLL_MS = 15000; // polling de segurança (caso o realtime caia)
const PREVIEW_LIMIT = 3000; // linhas recentes carregadas pra montar a lista de conversas

export default function AdminDora() {
  const [rows, setRows] = useState([]); // linhas cruas de dora_conversations (recentes)
  const [profilesById, setProfilesById] = useState({}); // { [user_id]: {email,name,phone} }
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [unread, setUnread] = useState({}); // { [session_id]: count }
  const [hasNewMsgs, setHasNewMsgs] = useState(false);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const [realtimeReady, setRealtimeReady] = useState(false);

  const chatBodyRef = useRef(null);
  const messagesEndRef = useRef(null);
  const msgChannelRef = useRef(null);
  const lastMessageIdRef = useRef(null);
  const selectedSessionRef = useRef(null);

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
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // ---------- helpers de scroll ----------
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

  function markRead(sessionId) {
    setUnread((prev) => ({ ...prev, [sessionId]: 0 }));
    setHasNewMsgs(false);
  }

  // ---------- helpers de data/hora (pt-BR) ----------
  function toDate(v) {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
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
    return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
  }
  function dayLabel(v) {
    const d = toDate(v);
    if (!d) return "—";
    const now = new Date();
    const k = dayKey(d);
    if (k === dayKey(now)) return "Hoje";
    if (k === dayKey(new Date(now.getTime() - 86400000))) return "Ontem";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    }).format(d);
  }

  // ---------- carregamento ----------
  async function loadList() {
    try {
      setError("");
      setLoadingList(true);

      const { data, error } = await supabase
        .from("dora_conversations")
        .select("session_id,user_id,role,content,created_at")
        .order("created_at", { ascending: false })
        .limit(PREVIEW_LIMIT);

      if (error) {
        console.error("[Dora] loadList error:", error);
        setError(error.message || "Erro ao carregar conversas");
        setRows([]);
        return;
      }

      setRows(data || []);

      const userIds = [...new Set((data || []).map((r) => r.user_id).filter(Boolean))];
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,email,name,phone")
          .in("id", userIds);
        const map = {};
        for (const p of profs || []) map[p.id] = p;
        setProfilesById(map);
      }
    } catch (e) {
      console.error("[Dora] loadList exception:", e);
      setError(String(e?.message || e));
      setRows([]);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadMessages(sessionId, opts = {}) {
    const { scroll = true, behavior = "auto" } = opts;
    try {
      setError("");
      setLoadingMsgs(true);

      const { data, error } = await supabase
        .from("dora_conversations")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[Dora] loadMessages error:", error);
        setError(error.message || "Erro ao carregar mensagens");
        setMessages([]);
        return;
      }

      setMessages(data || []);
      markRead(sessionId);
      if (scroll) scrollToBottom(behavior);
    } catch (e) {
      console.error("[Dora] loadMessages exception:", e);
      setError(String(e?.message || e));
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  }

  function openChat(sessionId) {
    setSelectedSessionId(sessionId);
    setHasNewMsgs(false);
    setText("");
    loadMessages(sessionId, { scroll: true, behavior: "auto" });
  }

  async function sendMessage() {
    if (!selectedSessionId) return;
    const msg = text.trim();
    if (!msg) return;

    try {
      setSending(true);
      setError("");

      const userIdForSession = rows.find((r) => r.session_id === selectedSessionId)?.user_id || null;

      const { data, error } = await supabase
        .from("dora_conversations")
        .insert({ session_id: selectedSessionId, user_id: userIdForSession, role: "admin", content: msg })
        .select("*")
        .single();

      if (error) {
        console.error("[Dora] sendMessage error:", error);
        setError(error.message || "Erro ao enviar mensagem");
        return;
      }

      setText("");
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
      scrollToBottom("smooth");
    } catch (e) {
      console.error("[Dora] sendMessage exception:", e);
      setError(String(e?.message || e));
    } finally {
      setSending(false);
    }
  }

  // ---------- efeitos ----------
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(loadList, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    lastMessageIdRef.current = messages?.[messages.length - 1]?.id || null;
  }, [messages]);

  // Realtime exige o JWT do admin no socket (RLS restringe a tabela a ele)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (token) supabase.realtime.setAuth(token);
      } catch {}
      if (active) setRealtimeReady(true);
    })();

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        try {
          supabase.realtime.setAuth(session.access_token);
        } catch {}
      }
    });

    return () => {
      active = false;
      try {
        authSub?.subscription?.unsubscribe?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (!realtimeReady) return;

    if (msgChannelRef.current) {
      try {
        supabase.removeChannel(msgChannelRef.current);
      } catch {}
      msgChannelRef.current = null;
    }

    const channel = supabase
      .channel("admin-dora-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dora_conversations" },
        (payload) => {
          const newMsg = payload?.new;
          if (!newMsg?.id) return;

          setRows((prev) => [
            {
              session_id: newMsg.session_id,
              user_id: newMsg.user_id,
              role: newMsg.role,
              content: newMsg.content,
              created_at: newMsg.created_at,
            },
            ...prev,
          ]);

          const isThisChatOpen = selectedSessionRef.current === newMsg.session_id;

          if (isThisChatOpen) {
            if (newMsg.id === lastMessageIdRef.current) return;
            setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));

            if (newMsg.role === "admin" || isNearBottom()) {
              scrollToBottom("smooth");
              markRead(newMsg.session_id);
            } else {
              setHasNewMsgs(true);
            }

            if (newMsg.role !== "admin" && !isNearBottom()) {
              setUnread((prev) => ({ ...prev, [newMsg.session_id]: (prev[newMsg.session_id] || 0) + 1 }));
            }
          } else if (newMsg.role !== "admin") {
            setUnread((prev) => ({ ...prev, [newMsg.session_id]: (prev[newMsg.session_id] || 0) + 1 }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeReady]);

  // ---------- derivações: agrupa linhas cruas em "conversas" por session_id ----------
  const conversations = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const existing = map.get(r.session_id);
      if (!existing) {
        map.set(r.session_id, {
          session_id: r.session_id,
          user_id: r.user_id || null,
          last_content: r.content,
          last_role: r.role,
          last_created_at: r.created_at,
          count: 1,
        });
      } else {
        existing.count += 1;
        if (!existing.user_id && r.user_id) existing.user_id = r.user_id;
        // rows vem ordenado desc por created_at na carga inicial, então a
        // primeira ocorrência de cada session_id já é a mais recente — só
        // atualiza o preview se essa linha (via realtime) for mais nova.
        if (new Date(r.created_at) > new Date(existing.last_created_at)) {
          existing.last_content = r.content;
          existing.last_role = r.role;
          existing.last_created_at = r.created_at;
        }
      }
    }
    return [...map.values()].sort((a, b) => new Date(b.last_created_at) - new Date(a.last_created_at));
  }, [rows]);

  function identity(conv) {
    if (!conv?.user_id) return { title: "Visitante", subtitle: conv?.session_id?.slice(0, 8) || "" };
    const p = profilesById[conv.user_id];
    if (!p) return { title: conv.user_id.slice(0, 8), subtitle: "" };
    return { title: p.name || p.email || conv.user_id.slice(0, 8), subtitle: p.email || p.phone || "" };
  }

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .filter((c) => {
        if (!q) return true;
        const idn = identity(c);
        const hay = [idn.title, idn.subtitle, c.session_id, c.last_content].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const aU = (unread[a.session_id] || 0) > 0 ? 1 : 0;
        const bU = (unread[b.session_id] || 0) > 0 ? 1 : 0;
        return bU - aU;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, search, unread, profilesById]);

  const totalUnread = useMemo(
    () => conversations.filter((c) => (unread[c.session_id] || 0) > 0).length,
    [conversations, unread]
  );

  const selectedConv = conversations.find((c) => c.session_id === selectedSessionId) || null;
  const selectedIdentity = selectedConv ? identity(selectedConv) : null;

  // ===== Estilos (mesmo padrão visual do AdminBotVendas) =====
  const S = {
    page: { display: "flex", height: "100dvh", background: "#0b0b0b", color: "rgba(255,255,255,0.92)", position: "relative" },
    column: { display: "flex", flexDirection: "column", minWidth: 0, height: "100%" },
    panelHeader: { padding: 12, borderBottom: "1px solid #2a2a2a", background: "rgba(255,255,255,0.02)" },
    headerTitleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    title: { fontWeight: 800 },
    subtitle: { fontSize: 12, opacity: 0.7, marginTop: 2 },
    actionsRow: { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" },
    btn: { padding: "8px 10px", borderRadius: 10, border: "1px solid #2a2a2a", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.92)", cursor: "pointer" },
    error: { marginTop: 10, fontSize: 12, color: "#ff6b6b" },
    listWrap: { overflowY: "auto", flex: 1 },
    listItem: (active, hasUnread) => ({
      padding: 12,
      paddingLeft: hasUnread && !active ? 10 : 12,
      borderBottom: "1px solid #1f1f1f",
      borderLeft: hasUnread && !active ? "3px solid #2ecc71" : "3px solid transparent",
      cursor: "pointer",
      background: active ? "rgba(255,255,255,0.06)" : hasUnread ? "rgba(46,204,113,0.05)" : "transparent",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }),
    listTopRow: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
    name: { fontWeight: 800, letterSpacing: 0.2 },
    unreadBadge: { minWidth: 18, height: 18, borderRadius: 999, background: "#2ecc71", color: "#08260f", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 },
    meta: { fontSize: 12, opacity: 0.75 },
    avatar: { width: 34, height: 34, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", fontSize: 16, fontWeight: 800, flex: "0 0 auto" },
    input: { flex: 1, padding: 10, borderRadius: 12, border: "1px solid #2a2a2a", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.92)", outline: "none", minWidth: 0 },
    chatBody: { flex: 1, overflowY: "auto", padding: 12 },
    daySep: { display: "flex", justifyContent: "center", margin: "12px 0" },
    dayChip: { fontSize: 12, opacity: 0.85, padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)" },
    msgRow: (role) => ({ display: "flex", justifyContent: role === "user" ? "flex-start" : "flex-end", marginBottom: 10 }),
    bubble: (role) => ({
      maxWidth: "86%",
      padding: "10px 12px",
      borderRadius: 14,
      border: role === "admin" ? "1px solid rgba(46,204,113,0.5)" : "1px solid rgba(255,255,255,0.10)",
      background: role === "user" ? "rgba(255,255,255,0.05)" : role === "admin" ? "rgba(46,204,113,0.14)" : "rgba(70,130,255,0.12)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      lineHeight: 1.35,
    }),
    msgMetaRow: { display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6, alignItems: "center" },
    msgMeta: { fontSize: 11, opacity: 0.65 },
    composer: { padding: 12, borderTop: "1px solid #2a2a2a", display: "flex", gap: 8, background: "rgba(0,0,0,0.35)", alignItems: "center" },
    btnPrimary: { padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(46,204,113,0.18)", color: "rgba(255,255,255,0.95)", cursor: "pointer", whiteSpace: "nowrap" },
    btnDisabled: { opacity: 0.55, cursor: "not-allowed" },
  };

  function roleLabel(role) {
    if (role === "user") return "👤 Pessoa";
    if (role === "admin") return "🙋 Você (atendimento)";
    return "🌸 Dora (IA)";
  }

  const ListPanel = (
    <div style={{ ...S.column, width: isMobile ? "100%" : 360, borderRight: isMobile ? "none" : "1px solid #2a2a2a" }}>
      <div style={S.panelHeader}>
        <div style={S.headerTitleRow}>
          <div>
            <div style={S.title}>Dora (chat do site)</div>
            <div style={S.subtitle}>/admin/dora</div>
          </div>
        </div>

        <div style={S.actionsRow}>
          <button onClick={loadList} style={S.btn}>Atualizar</button>
          <span style={{ ...S.meta, alignSelf: "center" }}>{conversations.length} conversas</span>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, e-mail ou mensagem…"
          style={{ ...S.input, marginTop: 10 }}
        />

        {totalUnread > 0 ? <div style={{ ...S.meta, marginTop: 8 }}>{totalUnread} conversa(s) não lida(s)</div> : null}
        {error ? <div style={S.error}>{error}</div> : null}
      </div>

      <div style={S.listWrap}>
        {loadingList ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Carregando conversas…</div>
        ) : conversations.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma conversa ainda.</div>
        ) : filteredConversations.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma conversa encontrada.</div>
        ) : (
          filteredConversations.map((c) => {
            const active = selectedSessionId === c.session_id;
            const unreadCount = unread[c.session_id] || 0;
            const idn = identity(c);
            return (
              <div key={c.session_id} onClick={() => openChat(c.session_id)} style={S.listItem(active, unreadCount > 0)}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={S.avatar}>{c.user_id ? "👤" : "🕵️"}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.listTopRow}>
                      <div style={{ ...S.name, fontWeight: unreadCount > 0 ? 900 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {idn.title}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        {unreadCount > 0 ? <div style={S.unreadBadge}>{unreadCount}</div> : null}
                        <span style={{ ...S.meta, opacity: 0.7 }}>{fmtTime(c.last_created_at)}</span>
                      </div>
                    </div>
                    {idn.subtitle ? <div style={{ ...S.meta, marginTop: 3 }}>{idn.subtitle}</div> : null}
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
                      {c.last_role === "user" ? "👤 " : c.last_role === "admin" ? "🙋 " : "🌸 "}
                      {c.last_content}
                    </div>
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
        {selectedConv ? (
          <div style={S.headerTitleRow}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={S.avatar}>{selectedConv.user_id ? "👤" : "🕵️"}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900 }}>{selectedIdentity.title}</div>
                {selectedIdentity.subtitle ? <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{selectedIdentity.subtitle}</div> : null}
              </div>
            </div>
            {isMobile ? (
              <button onClick={() => setSelectedSessionId(null)} style={S.btn}>← Voltar</button>
            ) : null}
          </div>
        ) : (
          <div style={{ opacity: 0.8 }}>Selecione uma conversa pra ver e responder.</div>
        )}
      </div>

      <div ref={chatBodyRef} style={S.chatBody} onScroll={() => { if (isNearBottom()) setHasNewMsgs(false); }}>
        {!selectedConv ? null : loadingMsgs ? (
          <div style={{ opacity: 0.8 }}>Carregando mensagens…</div>
        ) : messages.length === 0 ? (
          <div style={{ opacity: 0.8 }}>Sem mensagens nessa conversa.</div>
        ) : (
          <>
            {(() => {
              let lastDay = null;
              return messages.map((m) => {
                const k = dayKey(m.created_at);
                const showDay = k !== lastDay;
                lastDay = k;
                return (
                  <React.Fragment key={m.id}>
                    {showDay ? (
                      <div style={S.daySep}><div style={S.dayChip}>{dayLabel(m.created_at)}</div></div>
                    ) : null}
                    <div style={S.msgRow(m.role)}>
                      <div style={S.bubble(m.role)}>
                        <div style={S.msgMetaRow}>
                          <div style={S.msgMeta}>{roleLabel(m.role)}</div>
                          <div style={S.msgMeta}>{fmtTime(m.created_at)}</div>
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}

            {hasNewMsgs ? (
              <button
                onClick={() => { scrollToBottom("smooth"); if (selectedSessionId) markRead(selectedSessionId); }}
                style={{ position: "sticky", bottom: 12, marginTop: 8, ...S.btn, alignSelf: "center" }}
              >
                Novas mensagens ↓
              </button>
            ) : null}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {selectedConv ? (
        <div style={S.composer}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Responder como Dora (atendimento humano)…"
            style={S.input}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            disabled={sending}
          />
          <button onClick={sendMessage} disabled={sending || !text.trim()} style={{ ...S.btnPrimary, ...(sending || !text.trim() ? S.btnDisabled : null) }}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div style={S.page}>
      {isMobile ? (selectedConv ? ChatPanel : ListPanel) : (
        <>
          {ListPanel}
          {ChatPanel}
        </>
      )}
    </div>
  );
}
