import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Eye, EyeOff } from "lucide-react";

const EDGE_FN_URL =
  "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/change-password";

export default function ChangePasswordModal({ isOpen, onClose }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    confirmPassword.length >= 6 &&
    newPassword === confirmPassword &&
    !loading;

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!canSubmit) return;

    if (newPassword !== confirmPassword) {
      setError("A nova senha e a confirmação não conferem.");
      return;
    }
    if (newPassword.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }

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
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body?.error ||
            body?.message ||
            `Erro ao trocar senha (${res.status}).`
        );
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (e) {
      setError(String(e?.message || "Erro inesperado. Tente novamente."));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
    setError("");
    setSuccess(false);
    onClose();
  }

  if (!isOpen) return null;

  const inputStyle = {
    width: "100%",
    padding: "10px 38px 10px 12px",
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

  const eyeStyle = {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.55)",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    alignItems: "center",
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
            Trocar senha
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
          Informe sua senha atual e escolha uma nova senha com pelo menos 6
          caracteres.
        </p>

        <label style={labelStyle}>Senha atual</label>
        <div style={{ position: "relative" }}>
          <input
            type={showCurrent ? "text" : "password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={loading || success}
            autoComplete="current-password"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => setShowCurrent((v) => !v)}
            style={eyeStyle}
            tabIndex={-1}
          >
            {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <label style={labelStyle}>Nova senha</label>
        <div style={{ position: "relative" }}>
          <input
            type={showNew ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={loading || success}
            autoComplete="new-password"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            style={eyeStyle}
            tabIndex={-1}
          >
            {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <label style={labelStyle}>Confirmar nova senha</label>
        <div style={{ position: "relative" }}>
          <input
            type={showNew ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading || success}
            autoComplete="new-password"
            style={inputStyle}
          />
        </div>

        {error && (
          <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>
            {error}
          </p>
        )}

        {success && (
          <p style={{ color: "#10b981", fontSize: 13, marginTop: 12 }}>
            Senha alterada com sucesso!
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
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || success}
            style={{
              flex: 1,
              padding: "11px",
              borderRadius: 10,
              border: "none",
              background:
                canSubmit && !success ? "#7c3aed" : "rgba(124,58,237,0.25)",
              color: canSubmit && !success ? "#fff" : "rgba(255,255,255,0.35)",
              fontSize: 14,
              fontWeight: 700,
              cursor: canSubmit && !success ? "pointer" : "not-allowed",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Salvando…" : success ? "Pronto!" : "Salvar nova senha"}
          </button>
        </div>
      </form>
    </div>
  );
}
