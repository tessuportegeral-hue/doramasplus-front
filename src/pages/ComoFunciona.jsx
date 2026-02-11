// src/pages/ComoFunciona.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export default function ComoFunciona() {
  const navigate = useNavigate();
  const location = useLocation(); // ✅ (ADICIONADO) pra capturar ?src=
  const videoRef = useRef(null);
  const [showUnmute, setShowUnmute] = useState(true);

  // ✅ PageView no "Como Funciona"
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

  // ✅ (ADICIONADO) captura o parâmetro src (ex.: ?src=ads) e salva no localStorage
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(location.search);
      const src = (params.get("src") || "").trim().toLowerCase();
      if (src) {
        localStorage.setItem("dp_traffic_src", src);
        localStorage.setItem("dp_traffic_src_ts", String(Date.now()));
      }
    } catch {}
  }, [location.search]);

  // 🎬 Vídeo
  const videoSrc =
    "https://doramasplus.b-cdn.net/WhatsApp%20Video%202026-01-29%20at%2018.46.38.mp4";

  // ✅ força autoplay muted (mobile friendly)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    v.muted = true;
    v.playsInline = true;

    const tryPlay = async () => {
      try {
        await v.play();
      } catch {
        // se o browser bloquear, usuário dá play manual
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
      // ignore
    } finally {
      setShowUnmute(false);
    }
  };

  // WhatsApp
  const whatsappNumber = "5518996796654";
  const whatsappMessage =
    "Ola eu vim do anuncio pelo site e estou com uma duvida. Você pode me ajudar?";
  const whatsappLink = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
    whatsappMessage
  )}`;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* 🎬 VÍDEO */}
        <div style={styles.videoWrap}>
          <video
            ref={videoRef}
            style={styles.video}
            autoPlay
            muted
            playsInline
            preload="metadata"
            controls
          >
            <source src={videoSrc} type="video/mp4" />
            Seu navegador não suporta vídeo.
          </video>

          {/* 🔊 Overlay para ativar som */}
          {showUnmute && (
            <button
              type="button"
              onClick={handleUnmute}
              style={styles.unmuteOverlay}
            >
              <div style={styles.unmuteBox}>
                <div style={styles.unmuteTitle}>🔊 O vídeo já começou</div>
                <div style={styles.unmuteSub}>Toque aqui para ativar o som</div>
              </div>
            </button>
          )}
        </div>

        {/* CTA */}
        <button
          style={styles.cta}
          onClick={() =>
            navigate(
              `/teste-gratis${location.search ? location.search : ""}` // ✅ (ADICIONADO) mantém ?src=ads
            )
          }
        >
          Quero fazer o teste grátis
        </button>

        {/* WhatsApp */}
        <a
          href={whatsappLink}
          target="_blank"
          rel="noreferrer"
          style={styles.whatsBtn}
        >
          <span style={styles.whatsIcon}>💬</span>
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
    position: "relative",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  },
  video: {
    width: "100%",
    display: "block",
    background: "#000",
  },

  // Overlay som
  unmuteOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.25)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  unmuteBox: {
    background: "rgba(0,0,0,0.7)",
    padding: "14px 16px",
    borderRadius: 14,
    textAlign: "center",
    border: "1px solid rgba(255,255,255,0.15)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
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

  // WhatsApp
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
