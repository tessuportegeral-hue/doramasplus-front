// src/pages/ComoFunciona.jsx
import React from "react";
import { useNavigate } from "react-router-dom";

export default function ComoFunciona() {
  const navigate = useNavigate();

  // Opção 1: vídeo local no /public
  // Coloque seu vídeo em: public/videos/explicacao.mp4
  const videoSrc = "/videos/explicacao.mp4";

  // Opção 2 (se preferir): vídeo hospedado (ex: Cloudflare / R2 / etc)
  // const videoSrc = "https://SEU_LINK_DO_VIDEO.mp4";

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>Como fazer o teste grátis no DoramasPlus 💜</h1>
        <p style={styles.p}>
          Assista o vídeo rápido abaixo e veja como: entrar no teste grátis, criar cadastro e assinar quando quiser.
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

        <p style={styles.small}>
          Se o botão não abrir, acesse: <b>/teste-gratis</b>
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
    color: "#fff",
  },
  container: {
    width: "100%",
    maxWidth: 720,
  },
  h1: {
    fontSize: 28,
    margin: "0 0 10px",
    lineHeight: 1.2,
  },
  p: {
    margin: "0 0 18px",
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
    height: "auto",
    display: "block",
  },
  cta: {
    marginTop: 16,
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
  small: {
    marginTop: 10,
    fontSize: 13,
    opacity: 0.75,
  },
};
