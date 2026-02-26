// src/pages/AdminSupport.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

export default function AdminSupport() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // ✅ scroll anchor (pra não voltar pro começo)
  const messagesEndRef = useRef(null);
  function scrollToBottom(behavior = "auto") {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    }, 50);
  }

  // ✅ Realtime refs
  const realtimeChannelRef = useRef(null);
  const lastMessageIdRef = useRef(null);

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

  // ✅ Client separado SOMENTE pro schema whatsapp (não mexe no resto do projeto)
  const supportSupabase = useMemo(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      console.error("[AdminSupport] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
      return null;
    }

    return createClient(url, anon, {
      auth: { persistSession: true },
      db: { schema: "whatsapp" }, // 👈 aqui é o ponto
    });
  }, []);

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportSupabase]);

  async function loadConversations() {
    try {
      setError("");
      setLoadingConvs(true);

      if (!supportSupabase) {
        setConversations([]);
        setError("VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não encontrado no frontend");
        return;
      }

      const { data, error } = await supportSupabase
        .from("conversations")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("[AdminSupport] loadConversations error:", error);
        setError(error.message || "Erro ao carregar conversas");
        setConversations([]);
        return;
      }

      setConversations(data || []);
    } catch (e) {
      console.error("[AdminSupport] loadConversations exception:", e);
      setError(String(e?.message || e));
      setConversations([]);
    } finally {
      setLoadingConvs(false);
    }
  }

  async function loadMessages(id, opts = {}) {
    const { scroll = true, behavior = "auto" } = opts;
    try {
      setError("");
      setLoadingMsgs(true);

      if (!supportSupabase) {
        setMessages([]);
        setError("VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não encontrado no frontend");
        return;
      }

      const { data, error } = await supportSupabase
        .from("messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[AdminSupport] loadMessages error:", error);
        setError(error.message || "Erro ao carregar mensagens");
        setMessages([]);
        return;
      }

      setMessages(data || []);

      if (scroll) scrollToBottom(behavior);
    } catch (e) {
      console.error("[AdminSupport] loadMessages exception:", e);
      setError(String(e?.message || e));
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  }

  function openChat(conv) {
    setSelected(conv);
    loadMessages(conv.id, { scroll: true, behavior: "auto" });
  }

  async function sendMessage() {
    if (!selected) return;
    const msg = text.trim();
    if (!msg) return;

    try {
      setSending(true);
      setError("");

      // ✅ Edge Function pode continuar usando seu client principal
      const { data, error } = await supabase.functions.invoke("whatsapp-send-human", {
        body: {
          conversation_id: selected.id,
          phone: selected.phone_number,
          text: msg,
        },
      });

      if (error) {
        console.error("[AdminSupport] sendMessage invoke error:", error);
        setError(error.message || "Erro ao enviar mensagem");
        return;
      }

      if (!data?.ok) {
        setError(data?.error || "Falha ao enviar mensagem");
        return;
      }

      setText("");
      // ✅ após enviar, recarrega e volta pro fim com smooth
      await loadMessages(selected.id, { scroll: true, behavior: "smooth" });
      await loadConversations();
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status) {
    if (!selected) return;

    try {
      setError("");

      const { data, error } = await supabase.functions.invoke("whatsapp-set-status", {
        body: {
          conversation_id: selected.id,
          status,
        },
      });

      if (error) {
        console.error("[AdminSupport] setStatus invoke error:", error);
        setError(error.message || "Erro ao alterar status");
        return;
      }

      if (!data?.ok) {
        setError(data?.error || "Falha ao alterar status");
        return;
      }

      await loadConversations();

      setSelected((prev) =>
        prev
          ? {
              ...prev,
              status,
              current_step: status === "bot" ? "menu" : "humano",
            }
          : prev
      );
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  // ✅ atualiza o lastMessageIdRef quando messages mudar (pra evitar duplicar)
  useEffect(() => {
    lastMessageIdRef.current = messages?.[messages.length - 1]?.id || null;
  }, [messages]);

  // ✅ Realtime: assina INSERT em whatsapp.messages por conversation_id
  useEffect(() => {
    // limpa canal antigo
    if (realtimeChannelRef.current) {
      try {
        supportSupabase?.removeChannel(realtimeChannelRef.current);
      } catch {}
      realtimeChannelRef.current = null;
    }

    if (!supportSupabase || !selected?.id) return;

    const channel = supportSupabase
      .channel(`admin-support-${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "whatsapp",
          table: "messages",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          const newMsg = payload?.new;
          if (!newMsg?.id) return;

          // evita duplicar
          if (newMsg.id === lastMessageIdRef.current) return;

          setMessages((prev) => {
            if (!prev) return [newMsg];
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          scrollToBottom("smooth");
          loadConversations();
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (realtimeChannelRef.current) {
        try {
          supportSupabase.removeChannel(realtimeChannelRef.current);
        } catch {}
        realtimeChannelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportSupabase, selected?.id]);

  // ===== Estilos (só UI) =====
  const S = {
    page: {
      display: "flex",
      height: "100dvh", // melhor no celular (teclado)
      background: "#0b0b0b",
      color: "rgba(255,255,255,0.92)",
    },
    column: {
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      height: "100%",
    },
    panelHeader: {
      padding: 12,
      borderBottom: "1px solid #2a2a2a",
      background: "rgba(255,255,255,0.02)",
    },
    headerTitleRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
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
    btnPrimary: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.10)",
      color: "rgba(255,255,255,0.95)",
      cursor: "pointer",
    },
    btnDanger: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(255,107,107,0.35)",
      background: "rgba(255,107,107,0.10)",
      color: "rgba(255,255,255,0.95)",
      cursor: "pointer",
    },
    btnDisabled: { opacity: 0.55, cursor: "not-allowed" },

    error: { marginTop: 10, fontSize: 12, color: "#ff6b6b" },

    listWrap: { overflowY: "auto", flex: 1 },
    listItem: (active) => ({
      padding: 12,
      borderBottom: "1px solid #1f1f1f",
      cursor: "pointer",
      background: active ? "rgba(255,255,255,0.06)" : "transparent",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }),
    listTopRow: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
    phone: { fontWeight: 700, letterSpacing: 0.2 },
    badge: (kind) => ({
      fontSize: 12,
      padding: "2px 8px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.14)",
      background: kind === "humano" ? "rgba(255,107,107,0.10)" : "rgba(70, 255, 170, 0.08)",
      opacity: 0.95,
      whiteSpace: "nowrap",
    }),
    meta: { fontSize: 12, opacity: 0.75 },

    chatBody: { flex: 1, overflowY: "auto", padding: 12 },
    msgRow: (dir) => ({
      display: "flex",
      justifyContent: dir === "outbound" ? "flex-end" : "flex-start",
      marginBottom: 10,
    }),
    bubble: (dir) => ({
      maxWidth: "86%",
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.10)",
      background: dir === "outbound" ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      lineHeight: 1.35,
    }),
    msgMeta: { fontSize: 11, opacity: 0.65, marginBottom: 6 },

    composer: {
      padding: 12,
      borderTop: "1px solid #2a2a2a",
      display: "flex",
      gap: 8,
      background: "rgba(0,0,0,0.35)",
    },
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
  };

  // ===== Render helpers =====
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
            <div style={S.title}>Atendimento WhatsApp</div>
            <div style={S.subtitle}>/admin/support</div>
          </div>

          {isMobile && selected ? (
            <button onClick={() => setSelected(null)} style={S.btn} title="Voltar">
              ←
            </button>
          ) : null}
        </div>

        <div style={S.actionsRow}>
          <button onClick={loadConversations} style={S.btn}>
            Atualizar
          </button>
        </div>

        {error ? <div style={S.error}>{error}</div> : null}
      </div>

      <div style={S.listWrap}>
        {loadingConvs ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Carregando conversas…</div>
        ) : conversations.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma conversa ainda.</div>
        ) : (
          conversations.map((c) => {
            const active = selected?.id === c.id;
            const st = (c.status || "bot").toLowerCase();
            return (
              <div key={c.id} onClick={() => openChat(c)} style={S.listItem(active)}>
                <div style={S.listTopRow}>
                  <div style={S.phone}>{c.phone_number}</div>
                  <div style={S.badge(st)}>{st}</div>
                </div>
                <div style={S.meta}>step: {c.current_step || "—"}</div>
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
          <>
            <div style={S.headerTitleRow}>
              <div>
                <div style={{ fontWeight: 800 }}>{selected.phone_number}</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  status: <b>{selected.status}</b> • step: <b>{selected.current_step || "—"}</b>
                </div>
              </div>

              {isMobile ? (
                <button onClick={() => setSelected(null)} style={S.btn}>
                  ← Voltar
                </button>
              ) : null}
            </div>

            <div style={S.actionsRow}>
              <button onClick={() => setStatus("humano")} style={S.btnDanger}>
                Assumir Humano
              </button>
              <button onClick={() => setStatus("bot")} style={S.btnPrimary}>
                Voltar Bot
              </button>
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.8 }}>Selecione uma conversa.</div>
        )}
      </div>

      <div style={S.chatBody}>
        {!selected ? null : loadingMsgs ? (
          <div style={{ opacity: 0.8 }}>Carregando mensagens…</div>
        ) : messages.length === 0 ? (
          <div style={{ opacity: 0.8 }}>Sem mensagens nessa conversa.</div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id} style={S.msgRow(m.direction)}>
                <div style={S.bubble(m.direction)}>
                  <div style={S.msgMeta}>{m.direction}</div>
                  <div>{m.body}</div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {selected ? (
        <div style={S.composer}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Digite sua resposta…"
            style={S.input}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button
            onClick={sendMessage}
            disabled={sending}
            style={{ ...S.btnPrimary, ...(sending ? S.btnDisabled : null) }}
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
