import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useNavigate } from "react-router-dom";

const EDGE_FN_URL =
  "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/delete-account";

export default function DeleteAccountModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canDelete = confirmation === "EXCLUIR";

  async function handleDelete() {
    if (!canDelete) return;
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
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Erro ao excluir conta (${res.status}).`);
        return;
      }

      await supabase.auth.signOut();
      navigate("/");
    } catch (e) {
      setError(String(e?.message || "Erro inesperado. Tente novamente."));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setConfirmation("");
    setError("");
    onClose();
  }

  if (!isOpen) return null;

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
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#0f0f0f",
          borderRadius: 16,
          border: "1px solid #2a2a2a",
          padding: 24,
        }}
      >
        {/* Título */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 17 }}>
            Excluir minha conta
          </div>
          <button
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

        {/* Aviso */}
        <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 1.55, marginBottom: 20 }}>
          Tem certeza? Todos os seus dados serão deletados permanentemente e você
          perderá o acesso à sua assinatura.
        </p>

        {/* Campo de confirmação */}
        <label style={{ display: "block", color: "rgba(255,255,255,0.6)", fontSize: 13, marginBottom: 6 }}>
          Digite <strong style={{ color: "#ef4444" }}>EXCLUIR</strong> para confirmar
        </label>
        <input
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={loading}
          placeholder="EXCLUIR"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #2a2a2a",
            background: "rgba(255,255,255,0.04)",
            color: "#fff",
            fontSize: 14,
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        {error && (
          <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{error}</p>
        )}

        {/* Botões */}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
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
            onClick={handleDelete}
            disabled={!canDelete || loading}
            style={{
              flex: 1,
              padding: "11px",
              borderRadius: 10,
              border: "none",
              background: canDelete && !loading ? "#ef4444" : "rgba(239,68,68,0.25)",
              color: canDelete && !loading ? "#fff" : "rgba(255,255,255,0.35)",
              fontSize: 14,
              fontWeight: 700,
              cursor: canDelete && !loading ? "pointer" : "not-allowed",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Excluindo…" : "Excluir conta"}
          </button>
        </div>
      </div>
    </div>
  );
}
