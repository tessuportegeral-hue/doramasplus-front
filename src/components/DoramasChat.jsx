import { useState, useRef, useEffect } from "react";

const WHATSAPP = "5518996796654"; // ex: 5511999999999


export default function DoramasChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Oi! Sou a **Dora**, sua assistente do DoramasPlus 🌸 Como posso te ajudar hoje?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch(
        'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/dora-chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        }
      );
      const data = await response.json();
      const reply = data?.content?.[0]?.text || "Desculpa, não consegui responder agora. Tente novamente!";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Ops, tive um problema técnico. Tenta de novo em instantes! 😅" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Simple markdown bold parser
  const renderText = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: open
            ? "linear-gradient(135deg, #c0392b, #922b21)"
            : "linear-gradient(135deg, #e74c3c, #c0392b)",
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(231,76,60,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          transition: "all 0.2s ease",
          transform: open ? "scale(0.95)" : "scale(1)",
        }}
        aria-label="Abrir chat de suporte"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat window */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: "90px",
            right: "24px",
            width: "360px",
            maxWidth: "calc(100vw - 48px)",
            height: "500px",
            maxHeight: "calc(100vh - 120px)",
            borderRadius: "16px",
            background: "#0f0f0f",
            border: "1px solid #2a2a2a",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(231,76,60,0.1)",
            display: "flex",
            flexDirection: "column",
            zIndex: 9998,
            overflow: "hidden",
            animation: "slideUp 0.25s ease",
          }}
        >
          <style>{`
            @keyframes slideUp {
              from { opacity: 0; transform: translateY(12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .chat-msg { animation: fadeIn 0.2s ease; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
            .dot-pulse span { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #aaa; margin: 0 2px; animation: bounce 1.2s infinite; }
            .dot-pulse span:nth-child(2) { animation-delay: 0.2s; }
            .dot-pulse span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes bounce { 0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
            .chat-input:focus { outline: none; }
            ::-webkit-scrollbar { width: 4px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
          `}</style>

          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              background: "linear-gradient(135deg, #1a0a0a, #1f0f0f)",
              borderBottom: "1px solid #2a2a2a",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #e74c3c, #c0392b)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                flexShrink: 0,
              }}
            >
              🌸
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: "600", fontSize: "14px", fontFamily: "system-ui" }}>
                Dora
              </div>
              <div style={{ color: "#e74c3c", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#2ecc71", display: "inline-block" }} />
                Online agora
              </div>
            </div>
            <div style={{ marginLeft: "auto", color: "#555", fontSize: "11px", fontFamily: "system-ui" }}>
              DoramasPlus
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className="chat-msg"
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background:
                      msg.role === "user"
                        ? "linear-gradient(135deg, #e74c3c, #c0392b)"
                        : "#1e1e1e",
                    color: "#fff",
                    fontSize: "13.5px",
                    lineHeight: "1.5",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    border: msg.role === "assistant" ? "1px solid #2a2a2a" : "none",
                    wordBreak: "break-word",
                  }}
                >
                  {renderText(msg.content)}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "16px 16px 16px 4px",
                    background: "#1e1e1e",
                    border: "1px solid #2a2a2a",
                  }}
                >
                  <div className="dot-pulse">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick suggestions (only at start) */}
          {messages.length === 1 && (
            <div style={{ padding: "0 16px 8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {["Como assinar?", "Não consigo acessar", "Me recomenda um dorama"].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); setTimeout(sendMessage, 0); setMessages((prev) => [...prev, { role: "user", content: q }]); setInput(""); }}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "20px",
                    border: "1px solid #333",
                    background: "transparent",
                    color: "#bbb",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontFamily: "system-ui",
                    transition: "all 0.15s",
                  }}
                  onMouseOver={(e) => { e.target.style.borderColor = "#e74c3c"; e.target.style.color = "#e74c3c"; }}
                  onMouseOut={(e) => { e.target.style.borderColor = "#333"; e.target.style.color = "#bbb"; }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input area */}
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid #2a2a2a",
              display: "flex",
              gap: "8px",
              alignItems: "flex-end",
              background: "#0f0f0f",
            }}
          >
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Digite sua dúvida..."
              rows={1}
              style={{
                flex: 1,
                background: "#1a1a1a",
                border: "1px solid #2a2a2a",
                borderRadius: "12px",
                padding: "10px 14px",
                color: "#fff",
                fontSize: "13.5px",
                fontFamily: "system-ui, -apple-system, sans-serif",
                resize: "none",
                lineHeight: "1.4",
                maxHeight: "80px",
                overflowY: "auto",
              }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 80) + "px";
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                background: input.trim() && !loading ? "linear-gradient(135deg, #e74c3c, #c0392b)" : "#2a2a2a",
                border: "none",
                cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "all 0.15s",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
