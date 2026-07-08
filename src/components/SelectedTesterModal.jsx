import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";
const LS_KEY = "selected_tester_modal_shown";

export default function SelectedTesterModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!user?.id) return;

      // Já foi exibido antes neste dispositivo → nunca mostra de novo
      try {
        if (window.localStorage.getItem(LS_KEY)) return;
      } catch {
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("is_selected_tester")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled || error) return;
      if (data?.is_selected_tester === true) setOpen(true);
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  function handleClose() {
    try {
      window.localStorage.setItem(LS_KEY, "true");
    } catch {}
    setOpen(false);
  }

  function handleDownload() {
    try {
      window.localStorage.setItem(LS_KEY, "true");
    } catch {}
    setOpen(false);
    window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
  }

  if (!open) return null;

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
          maxWidth: 440,
          background: "#12091c",
          borderRadius: 16,
          border: "1px solid rgba(168,85,247,0.35)",
          boxShadow: "0 20px 60px rgba(168,85,247,0.25)",
          padding: 28,
          textAlign: "center",
          position: "relative",
        }}
      >
        {/* Fechar */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fechar"
          style={{
            position: "absolute",
            top: 14,
            right: 16,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            fontSize: 22,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ✕
        </button>

        {/* Título */}
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 14,
            background: "linear-gradient(90deg, #a855f7, #ec4899)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          🎉 Você foi selecionado(a)!
        </div>

        {/* Corpo */}
        <p
          style={{
            color: "rgba(255,255,255,0.82)",
            fontSize: 15,
            lineHeight: 1.6,
            marginBottom: 12,
          }}
        >
          Você é um dos nossos usuários mais fiéis, por isso te convidamos para o
          time de testes do nosso novo app oficial no Google Play!
        </p>
        <p
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 14,
            lineHeight: 1.6,
            marginBottom: 24,
          }}
        >
          Baixe agora e tenha uma experiência ainda mais rápida e prática para
          assistir seus doramas favoritos.
        </p>

        {/* Botões */}
        <button
          type="button"
          onClick={handleDownload}
          style={{
            width: "100%",
            padding: "13px",
            borderRadius: 12,
            border: "none",
            background: "linear-gradient(90deg, #a855f7, #ec4899)",
            color: "#fff",
            fontSize: 15,
            fontWeight: 800,
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          Baixar App
        </button>
        <button
          type="button"
          onClick={handleClose}
          style={{
            width: "100%",
            padding: "11px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent",
            color: "rgba(255,255,255,0.65)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Agora não
        </button>
      </div>
    </div>
  );
}
