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

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      setError("");
      setLoadingConvs(true);

      const { data, error } = await supabase
        .from("whatsapp.conversations")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      setConversations(data || []);
    } catch (e) {
      console.error("[AdminSupport] loadConversations:", e);
      setError(e.message || "Erro ao carregar conversas");
      setConversations([]);
    } finally {
      setLoadingConvs(false);
    }
  }

  async function loadMessages(id) {
    try {
      setError("");
      setLoadingMsgs(true);

      const { data, error } = await supabase
        .from("whatsapp.messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setMessages(data || []);
    } catch (e) {
      console.error("[AdminSupport] loadMessages:", e);
      setError(e.message || "Erro ao carregar mensagens");
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

      const { data, error } = await supabase.functions.invoke(
        "whatsapp-send-human",
        {
          body: {
            conversation_id: selected.id,
            phone: selected.phone_number,
            text: msg,
          },
        }
      );

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao enviar");

      setText("");
      await loadMessages(selected.id);
      await loadConversations();
    } catch (e) {
      console.error("[AdminSupport] sendMessage:", e);
      setError(e.message || "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status) {
    if (!selected) return;

    try {
      setError("");

      const { data, error } = await supabase.functions.invoke(
        "whatsapp-set-status",
        {
          body: {
            conversation_id: selected.id,
            status,
          },
        }
      );

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao alterar status");

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
      console.error("[AdminSupport] setStatus:", e);
      setError(e.message || "Erro ao alterar status");
    }
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* LISTA */}
      <div style={{ width: 360, borderRight: "1px solid #2a2a2a" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #2a2a2a" }}>
          <div style={{ fontWeight: 700 }}>Atendimento WhatsApp</div>

          <button
            onClick={loadConversations}
            style={{ marginTop: 10, padding: "6px 10px" }}
          >
            Atualizar
          </button>

          {error && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#ff6b6b" }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ overflowY: "auto", height: "calc(100vh - 70px)" }}>
          {loadingConvs ? (
            <div style={{ padding: 12 }}>Carregando…</div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: 12 }}>Nenhuma conversa ainda.</div>
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
                    selected?.id === c.id
                      ? "rgba(255,255,255,0.06)"
                      : "transparent",
                }}
              >
                <div style={{ fontWeight: 600 }}>{c.phone_number}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {c.status || "bot"}
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

              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => setStatus("humano")}
                  style={{ marginRight: 8 }}
                >
                  Assumir Humano
                </button>

                <button onClick={() => setStatus("bot")}>
                  Voltar Bot
                </button>
              </div>
            </>
          ) : (
            <div>Selecione uma conversa.</div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 10 }}>
              <b>{m.direction}:</b> {m.body}
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ padding: 12, borderTop: "1px solid #2a2a2a" }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite..."
              style={{ width: "80%", padding: 8 }}
            />

            <button
              onClick={sendMessage}
              disabled={sending}
              style={{ marginLeft: 8 }}
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
