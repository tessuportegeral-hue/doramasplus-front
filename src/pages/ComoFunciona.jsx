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
        <h1 style={styles.h1}>Como fazer o teste grátis no DoramasPlus 💜</h1>

        <p style={styles.p}>
          Assista o vídeo abaixo e veja como entrar no teste grátis, criar
          cadastro e assinar quando quiser.
        </p>

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

        <button style={styles.cta} onClick={() => navigate("/teste-gratis")}>
          Quero fazer o teste grátis
        </button>

        {/* ✅ BOTÃO WHATSAPP (mais bonito e clicável) */}
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

        <p style={styles.smallNote}>
          Número: <b>18 99679-6654</b> (mensagem automática já vai pronta)
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

  // ✅ WhatsApp button
  whatsBtn: {
    marginTop: 12,
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 14,
    textDecoration: "none",
    fontSize: 15,
    fontWeight: 800,
    background: "#19c37d",
    color: "#0b0b10",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
  },
  whatsIcon: {
    fontSize: 18,
    lineHeight: 1,
  },
  smallNote: {
    marginTop: 10,
    fontSize: 13,
    opacity: 0.85,
  },
};
