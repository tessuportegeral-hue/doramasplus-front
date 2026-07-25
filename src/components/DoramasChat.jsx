import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

const WHATSAPP = "5518996796654"; // ex: 5511999999999

// A Dora usa ||| sozinho numa linha pra marcar onde a resposta deve virar
// balões separados (ex: chave PIX isolada, fácil de copiar sem pegar texto junto).
const splitAssistantReply = (text) =>
  String(text || "")
    .split(/\n?\|\|\|\n?/)
    .map((part) => part.trim())
    .filter(Boolean);

// Toda resposta que escala pro suporte humano inclui esse link — usa isso
// pra sinalizar "precisa de humano" no painel /admin/dora sem precisar de
// lógica extra no backend (ver [[project-admin-dora-chat-feature]]).
const needsHuman = (text) => String(text || "").includes(`wa.me/${WHATSAPP}`);

// ✅ 25/07: FAQ clicável (referência: widget da concorrência com lista de
// artigos prontos). Em vez de respostas fixas separadas, cada clique só
// manda a pergunta pra Dora responder normal (sendText) — assim a resposta
// nunca fica desincronizada do que ela realmente sabe fazer (ex: renovação
// consulta o status real da conta, não é texto genérico).
const FAQ_QUESTIONS = [
  { icon: "🔑", q: "Como eu ativo meu acesso?" },
  { icon: "💳", q: "Quais as formas de pagamento?" },
  { icon: "🔒", q: "Esqueci minha senha" },
  { icon: "🔇", q: "O vídeo está sem som, o que eu faço?" },
  { icon: "🔄", q: "Já sou assinante, como renovo?" },
  { icon: "📲", q: "Como coloco o app na tela inicial?" },
];

const GREETING = {
  role: "assistant",
  content: "Oi! Sou a **Dora**, sua assistente do DoramasPlus 🌸 Como posso te ajudar hoje?",
};

export default function DoramasChat() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("conversa"); // "conversa" | "artigos"
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const proactiveFiredRef = useRef(false);
  const sessionIdRef = useRef(crypto.randomUUID());
  const lastAdminSeenRef = useRef(new Date().toISOString());
  const [hasUnreadAdmin, setHasUnreadAdmin] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
    if (open) setHasUnreadAdmin(false);
  }, [open]);

  // Um atendente pode responder direto pelo painel admin (/admin/dora).
  // Não existe realtime pra visitante anônimo aqui (a tabela só é legível
  // pelo admin via RLS), então a Dora fica perguntando de tempos em tempos
  // se chegou alguma resposta nova pra essa sessão.
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const resp = await fetch(
          "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/dora-poll-admin-replies",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionIdRef.current,
              after: lastAdminSeenRef.current,
            }),
          }
        );
        const data = await resp.json();
        const msgs = Array.isArray(data?.messages) ? data.messages : [];
        if (cancelled || !msgs.length) return;

        lastAdminSeenRef.current = msgs[msgs.length - 1].created_at;
        setMessages((prev) => [
          ...prev,
          ...msgs.map((m) => ({ role: "assistant", content: m.content, fromAdmin: true })),
        ]);
        setOpen((wasOpen) => {
          if (!wasOpen) setHasUnreadAdmin(true);
          return wasOpen;
        });
      } catch {
        // silencioso — só tenta de novo no próximo intervalo
      }
    };

    const id = setInterval(poll, 7000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Mensagens de admin criadas fora de uma sessão ao vivo (ex.: broadcast de
  // desculpas) não chegam pelo poll acima, porque esse poll é por session_id
  // e cada carregamento de página gera um session_id novo. Essa checagem usa
  // a conta logada (user_id) pra entregar isso assim que o usuário volta.
  useEffect(() => {
    let cancelled = false;

    const checkRecovery = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const resp = await fetch(
          "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/dora-recovery-check",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
          }
        );
        const data = await resp.json();
        const msgs = Array.isArray(data?.messages) ? data.messages : [];
        if (cancelled || !msgs.length) return;

        setMessages((prev) => [
          ...prev,
          ...msgs.map((m) => ({ role: "assistant", content: m.content, fromAdmin: true })),
        ]);
        setOpen((wasOpen) => {
          if (!wasOpen) setHasUnreadAdmin(true);
          return wasOpen;
        });
      } catch {
        // silencioso — sem problema tentar de novo na próxima visita
      }
    };

    checkRecovery();
    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ 25/07: recupera o histórico de conversa dos últimos 30 dias pra quem
  // está logado — sem isso, a conversa começava do zero toda vez que a
  // pessoa fechava e reabria o site, mesmo tendo falado com a Dora recente.
  // Só funciona logado (dora_conversations.user_id) — anônimo continua com
  // sessão nova a cada visita, sem identidade estável pra buscar histórico.
  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const resp = await fetch(
          "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/dora-load-history",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
          }
        );
        const data = await resp.json();
        const msgs = Array.isArray(data?.messages) ? data.messages : [];
        if (cancelled || !msgs.length) return;

        setMessages(
          msgs.map((m) => ({
            role: m.role === "admin" ? "assistant" : m.role,
            content: m.content,
            fromAdmin: m.role === "admin",
          }))
        );
      } catch {
        // silencioso — sem histórico carregado, fica só a saudação padrão
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  // Permite abrir o chat de qualquer lugar do site (ex: banner da home)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openChat = () => setOpen(true);
    window.addEventListener("open-dora-chat", openChat);
    return () => window.removeEventListener("open-dora-chat", openChat);
  }, []);

  // Dora proativa em /plans: abre o chat após 15s parado na página
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.pathname.includes("/plans")) return;
    if (proactiveFiredRef.current) return;
    if (open) return;

    const timer = setTimeout(() => {
      if (proactiveFiredRef.current) return;
      proactiveFiredRef.current = true;
      setOpen(true);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Oi! Posso te ajudar a escolher o melhor plano? 😊",
        },
      ]);
    }, 15000);

    return () => clearTimeout(timer);
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
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;
      const response = await fetch(
        'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/dora-chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
            access_token: session?.access_token || null,
          }),
        }
      );
      const data = await response.json();
      const reply = data?.content?.[0]?.text || "Desculpa, não consegui responder agora. Tente novamente!";
      const replyParts = splitAssistantReply(reply);
      setMessages((prev) => [...prev, ...replyParts.map((part) => ({ role: "assistant", content: part }))]);
      fetch('https://fbngdxhkaueaolnyswgn.supabase.co/rest/v1/dora_conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify([
          { session_id: sessionIdRef.current, user_id: userId, role: 'user', content: text },
          { session_id: sessionIdRef.current, user_id: userId, role: 'assistant', content: replyParts.join('\n\n'), needs_human: needsHuman(replyParts.join('\n\n')) }
        ])
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Ops, tive um problema técnico. Tenta de novo em instantes! 😅" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const sendText = async (text) => {
    if (loading) return;
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;
      const response = await fetch(
        'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/dora-chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
            access_token: session?.access_token || null,
          }),
        }
      );
      const data = await response.json();
      const reply = data?.content?.[0]?.text || "Desculpa, não consegui responder agora. Tente novamente!";
      const replyParts = splitAssistantReply(reply);
      setMessages((prev) => [...prev, ...replyParts.map((part) => ({ role: "assistant", content: part }))]);
      fetch('https://fbngdxhkaueaolnyswgn.supabase.co/rest/v1/dora_conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify([
          { session_id: sessionIdRef.current, user_id: userId, role: 'user', content: text },
          { session_id: sessionIdRef.current, user_id: userId, role: 'assistant', content: replyParts.join('\n\n'), needs_human: needsHuman(replyParts.join('\n\n')) }
        ])
      });
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Ops, tive um problema técnico. Tenta de novo em instantes! 😅" }]);
    } finally {
      setLoading(false);
    }
  };

  // Imagem enviada pela pessoa — a Dora identifica o que é (comprovante,
  // dorama, etc.) e reage de acordo (ver dora-chat/analisar_comprovante_pix).
  const sendImage = async (mimeType, base64, previewDataUrl) => {
    if (loading) return;
    const placeholderText = "📎 Imagem enviada";
    const newMessages = [...messages, { role: "user", content: placeholderText, imageDataUrl: previewDataUrl }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || null;
      const response = await fetch(
        'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/dora-chat',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
            access_token: session?.access_token || null,
            image: { base64, mime_type: mimeType },
          }),
        }
      );
      const data = await response.json();
      const reply = data?.content?.[0]?.text || "Desculpa, não consegui analisar agora. Tenta reenviar em instantes!";
      const replyParts = splitAssistantReply(reply);
      setMessages((prev) => [...prev, ...replyParts.map((part) => ({ role: "assistant", content: part }))]);
      fetch('https://fbngdxhkaueaolnyswgn.supabase.co/rest/v1/dora_conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify([
          { session_id: sessionIdRef.current, user_id: userId, role: 'user', content: placeholderText },
          { session_id: sessionIdRef.current, user_id: userId, role: 'assistant', content: replyParts.join('\n\n'), needs_human: needsHuman(replyParts.join('\n\n')) }
        ])
      });
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Ops, tive um problema ao analisar a imagem. Tenta de novo em instantes! 😅" }]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      if (base64) sendImage(file.type, base64, dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Simple markdown bold + URL parser
  const renderLinks = (text, keyPrefix) => {
    const urlRegex = /(https:\/\/[^\s]+)/g;
    const segments = text.split(urlRegex);
    return segments.map((seg, j) => {
      if (urlRegex.test(seg)) {
        urlRegex.lastIndex = 0;
        const isWhats = seg.startsWith("https://wa.me/");
        return (
          <a
            key={`${keyPrefix}-l-${j}`}
            href={seg}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: isWhats ? "#25D366" : "#e74c3c",
              textDecoration: "underline",
              wordBreak: "break-all",
            }}
          >
            {seg}
          </a>
        );
      }
      return <span key={`${keyPrefix}-t-${j}`}>{seg}</span>;
    });
  };

  const renderText = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{renderLinks(part.slice(2, -2), `b${i}`)}</strong>
      ) : (
        <span key={i}>{renderLinks(part, `s${i}`)}</span>
      )
    );
  };

  // Esconde o chat da Dora nas telas do player (/watch)
  if ((location.pathname || "").includes("/watch")) {
    return null;
  }

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
        {!open && hasUnreadAdmin && (
          <span
            style={{
              position: "absolute",
              top: "2px",
              right: "2px",
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: "#2ecc71",
              border: "2px solid #0f0f0f",
            }}
          />
        )}
      </button>

      {/* Chat window */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: isMobile ? "80px" : "90px",
            right: isMobile ? "12px" : "24px",
            width: "360px",
            maxWidth: isMobile ? "calc(100vw - 24px)" : "calc(100vw - 48px)",
            height: "auto",
            minHeight: messages.length <= 1 ? "auto" : "200px",
            maxHeight: isMobile ? "60vh" : "500px",
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

          {/* Tabs: Conversação / Artigos */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #2a2a2a",
              background: "#0f0f0f",
              flexShrink: 0,
            }}
          >
            {[
              { key: "conversa", label: "💬 Conversação" },
              { key: "artigos", label: "📖 Artigos" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  background: "transparent",
                  border: "none",
                  borderBottom: activeTab === tab.key ? "2px solid #e74c3c" : "2px solid transparent",
                  color: activeTab === tab.key ? "#fff" : "#777",
                  fontSize: "12.5px",
                  fontWeight: activeTab === tab.key ? "700" : "500",
                  fontFamily: "system-ui",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "artigos" ? (
            /* Artigos: FAQ sempre acessível, separado da conversa */
            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              <div style={{ color: "#999", fontSize: "12px", fontFamily: "system-ui", marginBottom: "12px" }}>
                Perguntas frequentes — toque pra ver a resposta da Dora
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {FAQ_QUESTIONS.map((faq) => (
                  <button
                    key={faq.q}
                    onClick={() => {
                      setActiveTab("conversa");
                      sendText(faq.q);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "12px",
                      border: "1px solid #2a2a2a",
                      background: "#161616",
                      color: "#ddd",
                      fontSize: "12.5px",
                      fontFamily: "system-ui",
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.borderColor = "#e74c3c"; e.currentTarget.style.background = "#1c1414"; }}
                    onMouseOut={(e) => { e.currentTarget.style.borderColor = "#2a2a2a"; e.currentTarget.style.background = "#161616"; }}
                  >
                    <span style={{ fontSize: "16px", flexShrink: 0 }}>{faq.icon}</span>
                    <span style={{ flex: 1 }}>{faq.q}</span>
                    <span style={{ color: "#555", fontSize: "14px", flexShrink: 0 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
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
                      flexDirection: "column",
                      alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    {msg.fromAdmin && (
                      <div style={{ fontSize: "10px", color: "#2ecc71", marginBottom: "3px", fontFamily: "system-ui" }}>
                        Atendimento DoramasPlus
                      </div>
                    )}
                    <div
                      style={{
                        maxWidth: "82%",
                        padding: "10px 14px",
                        borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        background: msg.role === "user"
                          ? "linear-gradient(135deg, #e74c3c, #c0392b)"
                          : msg.fromAdmin
                          ? "#123a24"
                          : "#1e1e1e",
                        color: "#fff",
                        fontSize: "13.5px",
                        lineHeight: "1.5",
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        border: msg.role === "assistant" ? (msg.fromAdmin ? "1px solid #2ecc71" : "1px solid #2a2a2a") : "none",
                        wordBreak: "break-word",
                      }}
                    >
                      {msg.imageDataUrl && (
                        <img
                          src={msg.imageDataUrl}
                          alt="Comprovante enviado"
                          style={{ maxWidth: "160px", borderRadius: "8px", display: "block", marginBottom: "6px" }}
                        />
                      )}
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
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileSelected}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title="Enviar comprovante de pagamento"
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "50%",
                    background: "#1a1a1a",
                    border: "1px solid #2a2a2a",
                    cursor: loading ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.15s",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
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
            </>
          )}
        </div>
      )}
    </>
  );
}
