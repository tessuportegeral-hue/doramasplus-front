// src/pages/ComoFunciona.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function ComoFunciona() {
  const navigate = useNavigate();

  // ✅ PageView no "Como Funciona" (não quebra se o pixel não estiver carregado)
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

  // 🎬 Vídeo explicativo (Bunny CDN)
  const videoSrc = "https://doramasplus.b-cdn.net/Video-apresentacao.mp4";

  // WhatsApp suporte (com mensagem pré-definida)
  const whatsappNumber = "5518996796654";
  const whatsappMessage =
    "Ola eu vim do anuncio pelo site e estou com uma duvida. Você pode me ajudar?";
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
    whatsappMessage
  )}`;

  const videoRef = useRef(null);
  const [showTapToUnmute, setShowTapToUnmute] = useState(true);

  // ✅ Autoplay (muted) pra funcionar no mobile
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    v.muted = true;
    v.playsInline = true;

    const tryPlay = async () => {
      try {
        await v.play();
      } catch {
        // se bloquear, a pessoa ainda pode dar play manual
      }
    };

    tryPlay();
  }, []);

  const handleUnmute = async () => {
    const v = videoRef.current;
    if (!v) return;

    try {
      v.muted = false;
      await v.play();
    } catch {
      // se falhar, pelo menos remove o overlay
    } finally {
      setShowTapToUnmute(false);
    }
  };

  const handleAnyUserPlay = () => {
    // mantém como está (overlay só some no unmute)
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* ✅ Somente o vídeo */}
        <div style={styles.videoOuter}>
          <div style={styles.videoWrap}>
            <video
              ref={videoRef}
              style={styles.video}
              controls
              playsInline
              preload="metadata"
              autoPlay
              muted
              onPlay={handleAnyUserPlay}
            >
              <source src={videoSrc} type="video/mp4" />
              Seu navegador não suporta vídeo.
            </video>

            {/* ✅ Overlay "toque pra ouvir" */}
            {showTapToUnmute && (
              <button
                type="button"
                onClick={handleUnmute}
                style={styles.unmuteOverlay}
              >
                <div style={styles.unmuteBox}>
                  <div style={styles.unmuteTitle}>🔊 Seu vídeo já começou</div>
                  <div style={styles.unmuteSub}>
                    Toque aqui para ativar o som
                  </div>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* ✅ Botão de acesso à plataforma */}
        <button style={styles.cta} onClick={() => navigate("/teste-gratis")}>
          Quero Assistir os Doramas
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
    padding: "24px 16px",
    background: "#0b0b10",
    color: "#ffffff",
  },
  container: {
    width: "100%",
    maxWidth: 720,
  },

  // ✅ vídeo centralizado
  videoOuter: {
    width: "100%",
    display: "flex",
    justifyContent: "center",
  },
  videoWrap: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 16,
    overflow: "hidden",
    background: "#111",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
    position: "relative",
  },
  video: {
    width: "100%",
    display: "block",
    background: "#000",
  },

  // Overlay "toque para ouvir"
  unmuteOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.18)",
    border: "none",
    padding: 0,
    cursor: "pointer",
  },
  unmuteBox: {
    padding: "12px 14px",
    borderRadius: 14,
    background: "rgba(0,0,0,0.65)",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
    textAlign: "center",
  },
  unmuteTitle: {
    fontWeight: 900,
    fontSize: 14,
    marginBottom: 4,
  },
  unmuteSub: {
    fontSize: 13,
    opacity: 0.95,
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

  // Botão WhatsApp
  whatsBtn: {
    marginTop: 14,
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
    background: "#25D366",
    color: "#0b0b10",
    boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
  },
  whatsIcon: {
    fontSize: 18,
    lineHeight: 1,
  },
};
