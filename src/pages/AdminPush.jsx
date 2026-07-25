// src/pages/AdminPush.jsx
// Painel simples pra disparar um push manual — promoção, aviso pontual,
// etc. Mostra quantos assinantes existem em cada segmento (antes de
// mandar) e o histórico dos envios anteriores.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import AdminTabs from "@/components/AdminTabs";

const SEGMENTS = [
  { value: "all", label: "Todo mundo" },
  { value: "active", label: "Só quem tá ativo" },
  { value: "expired", label: "Só quem venceu (reativação)" },
];

export default function AdminPush() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [segment, setSegment] = useState("all");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [counts, setCounts] = useState({ all: 0, active: 0, expired: 0 });
  const [history, setHistory] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);

  async function loadStats() {
    setLoadingStats(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("admin-send-push", {
        body: { action: "stats" },
      });
      if (!fnError && data?.ok) {
        setCounts(data.counts || { all: 0, active: 0, expired: 0 });
        setHistory(data.history || []);
      }
    } finally {
      setLoadingStats(false);
    }
  }

  useEffect(() => {
    loadStats();
  }, []);

  const segmentLabel = SEGMENTS.find((s) => s.value === segment)?.label || "Todo mundo";
  const segmentCount = counts[segment] ?? 0;

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      setError("Preenche o título e a mensagem.");
      return;
    }
    if (
      !window.confirm(
        `Enviar essa notificação pra "${segmentLabel}" (${segmentCount} pessoa(s)) agora?\n\n"${title}"\n${body}`
      )
    ) {
      return;
    }

    setSending(true);
    setError("");
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("admin-send-push", {
        body: { title: title.trim(), body: body.trim(), url: url.trim() || "/", segment },
      });

      if (fnError || !data?.ok) {
        setError(data?.error || fnError?.message || "Falha ao enviar.");
        return;
      }

      setResult(data);
      setTitle("");
      setBody("");
      setUrl("/");
      loadStats();
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
          Manda uma notificação pontual pro público que você escolher (promoção, aviso, etc).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, display: "block", marginBottom: 6 }}>
              Pra quem enviar
            </label>
            <select value={segment} onChange={(e) => setSegment(e.target.value)} style={inputStyle}>
              {SEGMENTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({loadingStats ? "..." : counts[s.value] ?? 0})
                </option>
              ))}
            </select>
            <p style={{ color: "#c4b5fd", fontSize: 12, marginTop: 6, fontWeight: 700 }}>
              📲 {loadingStats ? "Carregando..." : `${segmentCount} pessoa(s) vão receber`}
            </p>
          </div>

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
            {sending ? "Enviando..." : `Enviar pra "${segmentLabel}"`}
          </button>
        </div>

        <div style={{ marginTop: 40 }}>
          <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
            Histórico de envios
          </h2>
          {history.length === 0 ? (
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Nenhum envio manual ainda.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {history.map((h) => (
                <div
                  key={h.id}
                  style={{
                    background: "#111111",
                    border: "1px solid #2a2a2a",
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{h.title}</span>
                    <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, whiteSpace: "nowrap" }}>
                      {new Date(h.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, margin: "4px 0 6px" }}>{h.body}</p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ color: "#86efac", fontSize: 11, fontWeight: 700 }}>
                      {h.sent}/{h.total} entregues
                    </span>
                    <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 700 }}>
                      👆 {h.clicked || 0} clicou(aram){h.sent ? ` (${Math.round(((h.clicked || 0) / h.sent) * 100)}%)` : ""}
                    </span>
                    {h.segment && h.segment !== "all" && (
                      <span style={{ color: "#c4b5fd", fontSize: 11, fontWeight: 700 }}>
                        {SEGMENTS.find((s) => s.value === h.segment)?.label || h.segment}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
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
