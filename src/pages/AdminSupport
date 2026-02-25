import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function AdminSupport() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });

    setConversations(data || []);
  }

  async function loadMessages(id) {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    setMessages(data || []);
  }

  function openChat(conv) {
    setSelected(conv);
    loadMessages(conv.id);
  }

  async function sendMessage() {
    if (!text.trim()) return;

    await supabase.functions.invoke("whatsapp-send-human", {
      body: {
        conversation_id: selected.id,
        phone: selected.phone_number,
        text,
      },
    });

    setText("");
    loadMessages(selected.id);
  }

  async function setStatus(status) {
    await supabase.functions.invoke("whatsapp-set-status", {
      body: {
        conversation_id: selected.id,
        status,
      },
    });

    loadConversations();
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* LISTA */}
      <div style={{ width: 350, borderRight: "1px solid #ddd" }}>
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => openChat(c)}
            style={{
              padding: 10,
              borderBottom: "1px solid #eee",
              cursor: "pointer",
            }}
          >
            <div>{c.phone_number}</div>
            <small>Status: {c.status}</small>
          </div>
        ))}
      </div>

      {/* CHAT */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {selected && (
          <>
            <div style={{ padding: 10, borderBottom: "1px solid #ddd" }}>
              <b>{selected.phone_number}</b>

              <div style={{ marginTop: 5 }}>
                <button onClick={() => setStatus("humano")}>
                  Assumir Humano
                </button>

                <button onClick={() => setStatus("bot")}>
                  Voltar Bot
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
              {messages.map((m) => (
                <div key={m.id} style={{ marginBottom: 10 }}>
                  <b>{m.direction}</b>: {m.body}
                </div>
              ))}
            </div>

            <div style={{ padding: 10, borderTop: "1px solid #ddd" }}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{ width: "80%" }}
              />
              <button onClick={sendMessage}>Enviar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
