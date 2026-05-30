import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const EDGE_FN_URL =
  "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/update-user-email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function UpdateEmailModal({ isOpen, onClose, onUpdated }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const canSubmit = EMAIL_RE.test(email.trim()) && !loading && !success;

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!canSubmit) return;

    try {
      setLoading(true);
      setError("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("Sessão expirada. Faça login novamente.");
        return;
      }

      const res = await fetch(EDGE_FN_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 409 = email já em uso (mensagem vem do backend)
        setError(
          data?.error ||
            data?.message ||
            `Erro ao atualizar o email (${res.status}).`
        );
        return;
      }

      setSuccess(true);
      onUpdated?.();
    } catch (e) {
      setError(String(e?.message || "Erro inesperado. Tente novamente."));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setEmail("");
    setError("");
    setSuccess(false);
    onClose();
  }

  if (!isOpen) return null;

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #2a2a2a",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle = {
    display: "block",
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    marginBottom: 6,
    marginTop: 14,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#0f0f0f",
          borderRadius: 16,
          border: "1px solid #2a2a2a",
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 14,
          }}
        >
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 17 }}>
            Cadastre seu email
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.4)",
              fontSize: 20,
              cursor: loading ? "not-allowed" : "pointer",
              lineHeight: 1,
              padding: "0 0 0 12px",
            }}
          >
            ✕
          </button>
        </div>

        <p
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 13,
            lineHeight: 1.55,
            marginBottom: 4,
          }}
        >
          Para facilitar seu acesso, cadastre seu email real. Você poderá usar
          ele pra entrar na plataforma 💜
        </p>

        <label style={labelStyle}>Seu email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading || success}
          autoComplete="email"
          placeholder="voce@email.com"
          style={inputStyle}
        />

        {error && (
          <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>
            {error}
          </p>
        )}

        {success && (
          <p style={{ color: "#10b981", fontSize: 13, marginTop: 12 }}>
            Email atualizado! Agora você pode entrar com ele também 💜
          </p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            style={{
              flex: 1,
              padding: "11px",
              borderRadius: 10,
              border: "1px solid #2a2a2a",
              background: "transparent",
              color: "rgba(255,255,255,0.65)",
              fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {success ? "Fechar" : "Agora não"}
          </button>
          {!success && (
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                flex: 1,
                padding: "11px",
                borderRadius: 10,
                border: "none",
                background: canSubmit ? "#7c3aed" : "rgba(124,58,237,0.25)",
                color: canSubmit ? "#fff" : "rgba(255,255,255,0.35)",
                fontSize: 14,
                fontWeight: 700,
                cursor: canSubmit ? "pointer" : "not-allowed",
                transition: "background 0.15s",
              }}
            >
              {loading ? "Salvando…" : "Salvar"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
