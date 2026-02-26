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

  // ✅ melhorias
  const [search, setSearch] = useState("");
  const [previews, setPreviews] = useState({}); // { [conversationId]: { body, direction, created_at } }
  const [unread, setUnread] = useState({}); // { [conversationId]: number }
  const [hasNewMsgs, setHasNewMsgs] = useState(false);

  // ✅ anexos/mídia
  const [attachOpen, setAttachOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [mediaType, setMediaType] = useState("auto"); // auto|image|video|audio|document|sticker
  const [mediaFile, setMediaFile] = useState(null);

  // ✅ scroll
  const chatBodyRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

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

  function storageKeyRead(convId) {
    return `admin_support_last_read_${convId}`;
  }

  function markRead(convId) {
    try {
      localStorage.setItem(storageKeyRead(convId), String(Date.now()));
    } catch {}
    setUnread((prev) => ({ ...prev, [convId]: 0 }));
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

  // ✅ helpers de data/hora (pt-BR)
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

  // ✅ nome do contato (sem quebrar: tenta vários campos comuns)
  function getContactName(conv) {
    if (!conv) return "";
    return (
      conv.contact_name ||
      conv.profile_name ||
      conv.push_name ||
      conv.wa_name ||
      conv.name ||
      conv.display_name ||
      ""
    );
  }

  function getDisplayTitle(conv) {
    const name = getContactName(conv);
    return name ? name : conv?.phone_number || "";
  }

  function getDisplaySubtitle(conv) {
    const name = getContactName(conv);
    const phone = conv?.phone_number || "";
    return name ? phone : "";
  }

  // ✅ detecta tipo pelo arquivo (pra enviar mídia)
  function inferTypeFromFile(file) {
    const t = String(file?.type || "");
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("video/")) return "video";
    if (t.startsWith("audio/")) return "audio";
    return "document";
  }

  // ✅ pega public URL (upload) - bucket configurável
  async function uploadToStorageGetPublicUrl(file) {
    const bucket =
      import.meta.env.VITE_WA_MEDIA_BUCKET ||
      import.meta.env.VITE_SUPPORT_MEDIA_BUCKET ||
      "whatsapp-media";

    const ext = (file?.name || "").split(".").pop() || "bin";
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
    const path = `support/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });

    if (upErr) {
      throw new Error(
        `Upload falhou no bucket "${bucket}". Crie o bucket (public) ou ajuste policy. Detalhe: ${upErr.message}`
      );
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    const url = data?.publicUrl || "";
    if (!url) throw new Error("Não consegui gerar publicUrl do upload.");
    return { url, bucket, path };
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

      const rows = data || [];
      setMessages(rows);

      const last = rows[rows.length - 1];
      if (last) {
        setPreviews((prev) => ({
          ...prev,
          [id]: { body: last.body, direction: last.direction, created_at: last.created_at },
        }));
      }

      markRead(id);

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
    setHasNewMsgs(false);
    setAttachOpen(false);
    setMediaUrl("");
    setMediaCaption("");
    setMediaType("auto");
    setMediaFile(null);
    loadMessages(conv.id, { scroll: true, behavior: "auto" });
  }

  async function sendMessage() {
    if (!selected) return;
    const msg = text.trim();
    if (!msg) return;

    try {
      setSending(true);
      setError("");

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
      await loadMessages(selected.id, { scroll: true, behavior: "smooth" });
      await loadConversations();
    } finally {
      setSending(false);
    }
  }

  // ✅ envia mídia (URL ou arquivo -> upload storage -> URL)  [AGORA COM ERRO VISÍVEL]
  async function sendMedia() {
    if (!selected) return;

    try {
      setSending(true);
      setError("");

      let finalUrl = mediaUrl.trim();
      let finalType = mediaType;

      let filename = null;

      if (mediaFile) {
        const { url } = await uploadToStorageGetPublicUrl(mediaFile);
        finalUrl = url;
        filename = mediaFile?.name || null;
        if (finalType === "auto") finalType = inferTypeFromFile(mediaFile);
      }

      if (!finalUrl) {
        setError("Cola uma URL pública de mídia OU selecione um arquivo.");
        return;
      }

      if (finalType === "auto") finalType = "image";

      const { data, error } = await supabase.functions.invoke("whatsapp-send-human", {
        body: {
          conversation_id: selected.id,
          phone: selected.phone_number,
          type: finalType,
          media_url: finalUrl,
          caption: mediaCaption?.trim() || null,
          filename: filename || null,
        },
      });

      if (error) {
        console.error("[AdminSupport] sendMedia invoke error:", error);
        setError(error.message || "Erro ao enviar mídia");
        return;
      }

      if (!data?.ok) {
        setError(data?.error || "Falha ao enviar mídia");
        return;
      }

      setAttachOpen(false);
      setMediaUrl("");
      setMediaCaption("");
      setMediaType("auto");
      setMediaFile(null);

      await loadMessages(selected.id, { scroll: true, behavior: "smooth" });
      await loadConversations();
    } catch (e) {
      console.error("[AdminSupport] sendMedia fatal:", e);
      setError(String(e?.message || e));
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
          if (newMsg.id === lastMessageIdRef.current) return;

          const convId = newMsg.conversation_id;

          setPreviews((prev) => ({
            ...prev,
            [convId]: { body: newMsg.body, direction: newMsg.direction, created_at: newMsg.created_at },
          }));

          const isThisChatOpen = selected?.id === convId;

          if (isThisChatOpen) {
            setMessages((prev) => {
              if (!prev) return [newMsg];
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            if (newMsg.direction === "outbound" || isNearBottom()) {
              scrollToBottom("smooth");
              markRead(convId);
            } else {
              setHasNewMsgs(true);
            }

            if (newMsg.direction === "inbound" && !isNearBottom()) {
              setUnread((prev) => ({ ...prev, [convId]: (prev[convId] || 0) + 1 }));
              playBeep();
            }
          } else {
            if (newMsg.direction === "inbound") {
              setUnread((prev) => ({ ...prev, [convId]: (prev[convId] || 0) + 1 }));
              playBeep();
            }
          }

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
      height: "100dvh",
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
      gap: 8,
    }),
    listTopRow: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
    name: { fontWeight: 800, letterSpacing: 0.2 },
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

    chatBody: { flex: 1, overflowY: "auto", padding: 12 },

    daySep: {
      display: "flex",
      justifyContent: "center",
      margin: "12px 0",
    },
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
    msgMetaRow: {
      display: "flex",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 6,
      alignItems: "center",
    },
    msgMeta: { fontSize: 11, opacity: 0.65 },

    composer: {
      padding: 12,
      borderTop: "1px solid #2a2a2a",
      display: "flex",
      gap: 8,
      background: "rgba(0,0,0,0.35)",
      alignItems: "center",
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

    attachBox: {
      marginTop: 10,
      padding: 10,
      borderRadius: 12,
      border: "1px solid #2a2a2a",
      background: "rgba(255,255,255,0.03)",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    },
    row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
    smallInput: {
      flex: 1,
      padding: 10,
      borderRadius: 12,
      border: "1px solid #2a2a2a",
      background: "rgba(255,255,255,0.04)",
      color: "rgba(255,255,255,0.92)",
      outline: "none",
      minWidth: 180,
    },
    select: {
      padding: "10px 10px",
      borderRadius: 12,
      border: "1px solid #2a2a2a",
      background: "rgba(255,255,255,0.04)",
      color: "rgba(255,255,255,0.92)",
      outline: "none",
    },
    hint: { fontSize: 12, opacity: 0.7, lineHeight: 1.3 },
    fileChip: {
      fontSize: 12,
      padding: "4px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.05)",
      opacity: 0.95,
    },
  };

  const canSendMedia = !!selected && (!sending) && (!!mediaFile || !!mediaUrl.trim());

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

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número ou nome…"
          style={{ ...S.input, marginTop: 10 }}
        />

        {error ? <div style={S.error}>{error}</div> : null}
      </div>

      <div style={S.listWrap}>
        {loadingConvs ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Carregando conversas…</div>
        ) : conversations.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma conversa ainda.</div>
        ) : (
          conversations
            .filter((c) => {
              const q = search.trim();
              if (!q) return true;
              const phone = String(c.phone_number || "");
              const nm = String(getContactName(c) || "");
              return phone.includes(q) || nm.toLowerCase().includes(q.toLowerCase());
            })
            .map((c) => {
              const active = selected?.id === c.id;
              const st = (c.status || "bot").toLowerCase();
              const prev = previews[c.id];
              const unreadCount = unread[c.id] || 0;
              const title = getDisplayTitle(c);
              const subtitle = getDisplaySubtitle(c);

              return (
                <div key={c.id} onClick={() => openChat(c)} style={S.listItem(active)}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={S.avatar}>{avatarTextFromPhone(c.phone_number)}</div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={S.listTopRow}>
                        <div style={S.name}>{title}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {unreadCount > 0 ? (
                            <div
                              style={{
                                fontSize: 12,
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: "rgba(70,255,170,0.15)",
                                border: "1px solid rgba(70,255,170,0.25)",
                              }}
                            >
                              {unreadCount}
                            </div>
                          ) : null}
                          <div style={S.badge(st)}>{st}</div>
                        </div>
                      </div>

                      <div style={S.meta}>
                        {subtitle ? <span style={{ opacity: 0.9 }}>{subtitle}</span> : null}
                        <span style={{ marginLeft: subtitle ? 10 : 0 }}>
                          step: {c.current_step || "—"}
                        </span>
                        {prev?.created_at ? (
                          <span style={{ marginLeft: 10, opacity: 0.8 }}>• {fmtTime(prev.created_at)}</span>
                        ) : null}
                      </div>

                      {prev?.body ? (
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.72,
                            marginTop: 2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {prev.direction === "inbound" ? "👤 " : "🤖 "}
                          {prev.body}
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
          <>
            <div style={S.headerTitleRow}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <div style={S.avatar}>{avatarTextFromPhone(selected.phone_number)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900 }}>{getDisplayTitle(selected)}</div>
                  {getDisplaySubtitle(selected) ? (
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{getDisplaySubtitle(selected)}</div>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                    status: <b>{selected.status}</b> • step: <b>{selected.current_step || "—"}</b>
                  </div>
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

            {attachOpen ? (
              <div style={S.attachBox}>
                <div style={S.row}>
                  <select value={mediaType} onChange={(e) => setMediaType(e.target.value)} style={S.select}>
                    <option value="auto">auto</option>
                    <option value="image">image</option>
                    <option value="video">video</option>
                    <option value="audio">audio</option>
                    <option value="document">document</option>
                    <option value="sticker">sticker</option>
                  </select>

                  <button
                    style={S.btn}
                    onClick={() => fileInputRef.current?.click?.()}
                    title="Selecionar arquivo"
                    disabled={sending}
                  >
                    Escolher arquivo
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setMediaFile(f);
                      if (f) setMediaUrl("");
                    }}
                  />

                  {mediaFile ? <div style={S.fileChip}>{mediaFile.name}</div> : null}

                  <button
                    style={S.btn}
                    onClick={() => {
                      setAttachOpen(false);
                      setMediaUrl("");
                      setMediaCaption("");
                      setMediaType("auto");
                      setMediaFile(null);
                    }}
                    disabled={sending}
                  >
                    Fechar
                  </button>
                </div>

                <div style={S.row}>
                  <input
                    value={mediaUrl}
                    onChange={(e) => {
                      setMediaUrl(e.target.value);
                      if (e.target.value) setMediaFile(null);
                    }}
                    placeholder="OU cole uma URL pública (https://...)"
                    style={S.smallInput}
                    disabled={sending}
                  />
                </div>

                <div style={S.row}>
                  <input
                    value={mediaCaption}
                    onChange={(e) => setMediaCaption(e.target.value)}
                    placeholder="Legenda (opcional)"
                    style={S.smallInput}
                    disabled={sending}
                  />
                  <button
                    onClick={sendMedia}
                    disabled={!canSendMedia}
                    style={{ ...S.btnPrimary, ...(!canSendMedia ? S.btnDisabled : null) }}
                    title={!canSendMedia ? "Selecione um arquivo ou cole uma URL pública" : "Enviar mídia"}
                  >
                    {sending ? "Enviando…" : "Enviar mídia"}
                  </button>
                </div>

                <div style={S.hint}>
                  • Se você escolher arquivo, ele sobe no <b>Supabase Storage</b> (bucket padrão:{" "}
                  <b>{import.meta.env.VITE_WA_MEDIA_BUCKET || import.meta.env.VITE_SUPPORT_MEDIA_BUCKET || "whatsapp-media"}</b>).<br />
                  • Se der erro de policy/bucket, agora vai aparecer aqui em vermelho.<br />
                  • Sua Edge Function precisa aceitar <b>type</b> + <b>media_url</b> + <b>caption</b>.
                </div>
              </div>
            ) : null}

            {error ? <div style={S.error}>{error}</div> : null}
          </>
        ) : (
          <div style={{ opacity: 0.8 }}>Selecione uma conversa.</div>
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
                const created = m.created_at || m.inserted_at || null;
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
                          <div style={S.msgMeta}>{m.direction}</div>
                          <div style={S.msgMeta}>{fmtTime(created)}</div>
                        </div>
                        <div>{m.body}</div>
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
                  if (selected?.id) markRead(selected.id);
                }}
                style={{
                  position: "sticky",
                  bottom: 12,
                  marginTop: 8,
                  ...S.btnPrimary,
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
          <button
            onClick={() => setAttachOpen((v) => !v)}
            style={S.btn}
            title="Anexar mídia"
            disabled={sending}
          >
            📎
          </button>

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
            disabled={sending}
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
