// src/pages/ComoFunciona.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

export default function ComoFunciona() {
  const navigate = useNavigate();

  // Vídeo explicativo
  const videoSrc = "/videos/explicacao.mp4";

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
        <h1 style={styles.h1}>
          Como fazer o teste grátis no DoramasPlus 💜
        </h1>

        <p style={styles.p}>
          Assista o vídeo abaixo e veja como entrar no teste grátis, criar
          cadastro e assinar quando quiser.
        </p>

        <div style={styles.videoWrap}>
          <video
            style={styles.video}
            src={videoSrc}
            controls
            playsInline
            preload="metadata"
          />
        </div>

        <button
          style={styles.cta}
          onClick={() => navigate("/teste-gratis")}
        >
          Quero fazer o teste grátis
        </button>

        {/* TEXTO DE SUPORTE VIA WHATSAPP */}
        <p style={styles.supportText}>
          Dúvidas? envie mensagem para nosso Suporte no WhatsApp{" "}
          <a
            href={whatsappLink}
            target="_blank"
            rel="noreferrer"
            style={styles.supportLink}
          >
            18 99679-6654
          </a>
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    padding: "24px 16px",
    background: "#0b0b10",
    color: "#ffffff",
  },
  container: {
    width: "100%",
    maxWidth: 720,
  },
  h1: {
    fontSize: 28,
    marginBottom: 8,
    lineHeight: 1.2,
  },
  p: {
    marginBottom: 18,
    opacity: 0.9,
    lineHeight: 1.5,
  },
  videoWrap: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    background: "#111",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  },
  video: {
    width: "100%",
    display: "block",
  },
  cta: {
    marginTop: 18,
    width: "100%",
    padding: "14px 16px",
    borderRadius: 14,
    border: "none",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 700,
    background: "#b06cff",
    color: "#0b0b10",
  },
  supportText: {
    marginTop: 12,
    fontSize: 13,
    opacity: 0.85,
  },
  supportLink: {
    color: "#d6b3ff",
    fontWeight: 700,
    textDecoration: "underline",
  },
};
