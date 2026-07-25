// src/pages/AdminPush.jsx
// Painel simples pra disparar um push manual pra todo mundo assinado —
// promoção, aviso pontual, etc. Sem histórico de envios por enquanto.
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import AdminTabs from "@/components/AdminTabs";

export default function AdminPush() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      setError("Preenche o título e a mensagem.");
      return;
    }
    if (!window.confirm(`Enviar essa notificação pra TODOS os assinantes agora?\n\n"${title}"\n${body}`)) {
      return;
    }

    setSending(true);
    setError("");
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("admin-send-push", {
        body: { title: title.trim(), body: body.trim(), url: url.trim() || "/" },
      });

      if (fnError || !data?.ok) {
        setError(data?.error || fnError?.message || "Falha ao enviar.");
        return;
      }

      setResult(data);
      setTitle("");
      setBody("");
      setUrl("/");
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#050505" }}>
      <AdminTabs />
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px" }}>
        <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
          Enviar aviso push 🔔
        </h1>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 24 }}>
          Manda uma notificação pontual pra todo mundo que já assinou (promoção, aviso, etc).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, display: "block", marginBottom: 6 }}>
              Título
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Promoção relâmpago! 🎉"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, display: "block", marginBottom: 6 }}>
              Mensagem
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ex: Trimestral com 20% off só hoje, corre lá!"
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <div>
            <label style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, display: "block", marginBottom: 6 }}>
              Link ao clicar (opcional)
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/plans"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ color: "#f87171", fontSize: 13, background: "rgba(248,113,113,0.1)", padding: 10, borderRadius: 8 }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ color: "#86efac", fontSize: 13, background: "rgba(46,204,113,0.1)", padding: 10, borderRadius: 8 }}>
              Enviado! {result.sent}/{result.total} entregues com sucesso.
            </div>
          )}

          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            style={{
              background: "#7c3aed",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              padding: "12px 20px",
              borderRadius: 10,
              border: "none",
              cursor: sending ? "default" : "pointer",
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? "Enviando..." : "Enviar pra todos"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "#111111",
  border: "1px solid #2a2a2a",
  borderRadius: 10,
  padding: "10px 12px",
  color: "#fff",
  fontSize: 14,
  outline: "none",
};
