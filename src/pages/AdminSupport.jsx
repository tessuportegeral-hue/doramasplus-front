// src/pages/AdminSupport.jsx
import React, { useEffect, useState } from "react";
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

  // ✅ PostgREST direto (compatível com qualquer versão do supabase-js)
  const SUPABASE_URL =
    import.meta?.env?.VITE_SUPABASE_URL || import.meta?.env?.VITE_PUBLIC_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY =
    import.meta?.env?.VITE_SUPABASE_ANON_KEY || import.meta?.env?.VITE_PUBLIC_SUPABASE_ANON_KEY || "";

  async function restGet(pathWithQuery) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não encontrado no frontend");
    }

    // Se tiver usuário logado, usa o access_token (melhor pra RLS / policies)
    let token = SUPABASE_ANON_KEY;
    try {
      const { data } = await supabase.auth.getSession();
      const access = data?.session?.access_token;
      if (access) token = access;
    } catch {}

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Accept-Profile": "whatsapp",
        Prefer: "count=exact",
      },
    });

    const txt = await res.text();
    let json = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const msg =
        (json && (json.message || json.error || json.details)) ||
        txt ||
        `HTTP ${res.status}`;
      throw new Error(String(msg));
    }

    return json || [];
  }

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      setError("");
      setLoadingConvs(true);

      // ✅ schema whatsapp via Accept-Profile
      // order no PostgREST: order=updated_at.desc
      const data = await restGet(`conversations?select=*&order=updated_at.desc`);

      setConversations(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("[AdminSupport] loadConversations exception:", e);
      setError(String(e?.message || e));
      setConversations([]);
    } finally {
      setLoadingConvs(false);
    }
  }

  async function loadMessages(id) {
    try {
      setError("");
      setLoadingMsgs(true);

      // filter: conversation_id=eq.<id>
      const data = await restGet(
        `messages?select=*&conversation_id=eq.${encodeURIComponent(id)}&order=created_at.asc`
      );

      setMessages(Array.isArray(data) ? data : []);
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
    loadMessages(conv.id);
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
      await loadMessages(selected.id);
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

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* LISTA */}
      <div style={{ width: 360, borderRight: "1px solid #2a2a2a" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #2a2a2a" }}>
          <div style={{ fontWeight: 700 }}>Atendimento WhatsApp</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>/admin/support</div>

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={loadConversations} style={{ padding: "6px 10px" }}>
              Atualizar
            </button>
          </div>

          {error ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "#ff6b6b" }}>
              {error}
            </div>
          ) : null}
        </div>

        <div style={{ overflowY: "auto", height: "calc(100vh - 70px)" }}>
          {loadingConvs ? (
            <div style={{ padding: 12, opacity: 0.8 }}>Carregando conversas…</div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma conversa ainda.</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => openChat(c)}
                style={{
                  padding: 12,
                  borderBottom: "1px solid #1f1f1f",
                  cursor: "pointer",
                  background:
                    selected?.id === c.id ? "rgba(255,255,255,0.06)" : "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>{c.phone_number}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{c.status || "bot"}</div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  step: {c.current_step || "—"}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* CHAT */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #2a2a2a" }}>
          {selected ? (
            <>
              <div style={{ fontWeight: 700 }}>{selected.phone_number}</div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                status: <b>{selected.status}</b> • step: <b>{selected.current_step || "—"}</b>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button onClick={() => setStatus("humano")} style={{ padding: "6px 10px" }}>
                  Assumir Humano
                </button>
                <button onClick={() => setStatus("bot")} style={{ padding: "6px 10px" }}>
                  Voltar Bot
                </button>
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.8 }}>Selecione uma conversa na esquerda.</div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {!selected ? null : loadingMsgs ? (
            <div style={{ opacity: 0.8 }}>Carregando mensagens…</div>
          ) : messages.length === 0 ? (
            <div style={{ opacity: 0.8 }}>Sem mensagens nessa conversa.</div>
          ) : (
            messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 10 }}>
                <b style={{ fontSize: 12, opacity: 0.85 }}>{m.direction}</b>:{" "}
                <span>{m.body}</span>
              </div>
            ))
          )}
        </div>

        {selected ? (
          <div
            style={{
              padding: 12,
              borderTop: "1px solid #2a2a2a",
              display: "flex",
              gap: 8,
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite sua resposta…"
              style={{ flex: 1, padding: 8 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button onClick={sendMessage} disabled={sending} style={{ padding: "8px 12px" }}>
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
