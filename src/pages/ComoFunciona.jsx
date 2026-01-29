// src/pages/ComoFunciona.jsx
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function ComoFunciona() {
  const navigate = useNavigate();

  // ✅ PageView no "Como Funciona" (seguro mesmo se o pixel não carregar)
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (typeof window.fbq === "function") {
        window.fbq("track", "PageView");
      }
    } catch (e) {
      console.error("[pixel] PageView ComoFunciona error:", e);
    }
  }, []);

  // 🎬 Vídeo (Bunny CDN)
  const videoSrc =
    "https://doramasplus.b-cdn.net/WhatsApp%20Video%202026-01-29%20at%2018.46.38.mp4";

  // WhatsApp suporte (com mensagem pré-definida)
  const whatsappNumber = "5518996796654";
  const whatsappMessage =
    "Ola eu vim do anuncio pelo site e estou com uma duvida. Você pode me ajudar?";
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
    whatsappMessage
  )}`;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* 🎬 PLAYER DE VÍDEO */}
        <div style={styles.videoWrap}>
          <video
            style={styles.video}
            controls
            playsInline
            preload="metadata"
          >
            <source src={videoSrc} type="video/mp4" />
            Seu navegador não suporta vídeo.
          </video>
        </div>

        {/* ✅ Botão de acesso à plataforma */}
        <button style={styles.cta} onClick={() => navigate("/teste-gratis")}>
          Quero fazer o teste grátis
        </button>

        {/* ✅ Botão WhatsApp */}
        <a
          href={whatsappLink}
          target="_blank"
          rel="noreferrer"
          style={styles.whatsBtn}
        >
          <span style={styles.whatsIcon} aria-hidden="true">
            💬
          </span>
          Falar com o suporte no WhatsApp
        </a>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: "24px 16px",
    background: "#0b0b10",
    color: "#ffffff",
  },
  container: {
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },

  // 🎬 Vídeo
  videoWrap: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    background: "#000",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  },
  video: {
    width: "100%",
    display: "block",
    background: "#000",
  },

  // Botão principal
  cta: {
    width: "100%",
    padding: "16px",
    borderRadius: 16,
    border: "none",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 800,
    background: "#b06cff",
    color: "#0b0b10",
  },

  // Botão WhatsApp
  whatsBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "14px",
    borderRadius: 16,
    textDecoration: "none",
    fontSize: 15,
    fontWeight: 800,
    background: "#25D366",
    color: "#0b0b10",
    boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
  },
  whatsIcon: {
    fontSize: 18,
    lineHeight: 1,
  },
};
