// src/pages/ComoFunciona.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function ComoFunciona() {
  const navigate = useNavigate();

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

    // garante autoplay no mobile
    v.muted = true;
    v.playsInline = true;

    // tenta dar play (alguns browsers só deixam depois de interação)
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
    // se a pessoa clicar no vídeo e der play, a gente mantém o overlay,
    // porque ainda tá mutado. Se quiser sumir só no unmute, deixa assim.
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.h1}>Como fazer o teste grátis no DoramasPlus 💜</h1>

        <p style={styles.p}>
          Assista o vídeo abaixo e veja como entrar no teste grátis, criar
          cadastro e assinar quando quiser.
        </p>

        {/* ✅ Vídeo menor (mais "fino") e centralizado */}
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

            {/* ✅ Overlay "toque pra ouvir" igual seu outro site */}
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

        <button style={styles.cta} onClick={() => navigate("/teste-gratis")}>
          Quero fazer o teste grátis
        </button>

        {/* BOTÃO WHATSAPP */}
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

  // ✅ deixa o vídeo menor na página
  videoOuter: {
    width: "100%",
    display: "flex",
    justifyContent: "center",
  },
  videoWrap: {
    width: "100%",
    maxWidth: 520, // <<< diminui aqui (ex.: 480 / 520 / 560)
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
  smallNote: {
    marginTop: 10,
    fontSize: 13,
    opacity: 0.85,
  },
};
