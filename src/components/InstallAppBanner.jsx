import { useEffect, useState } from "react";

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && "ontouchend" in document)
  );
}

function isInStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIOS, setShowIOS] = useState(false);
  const [iosModalOpen, setIosModalOpen] = useState(false);

  useEffect(() => {
    // Não mostra se já está instalado (standalone)
    if (isInStandaloneMode()) return;

    if (isIOS()) {
      setShowIOS(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowAndroid(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setShowAndroid(false));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    setShowAndroid(false);
    setShowIOS(false);
    setIosModalOpen(false);
  }

  async function handleInstallAndroid() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
    setShowAndroid(false);
  }

  if (!showAndroid && !showIOS) return null;

  return (
    <>
      {/* Banner fixo no rodapé */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9990,
        background: "#111111",
        borderTop: "1px solid #2a2a2a",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <img
          src="/android-chrome-192x192.png"
          alt="DoramasPlus"
          style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>DoramasPlus</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 1 }}>
            Adicione à tela inicial para acesso rápido
          </div>
        </div>

        {showAndroid ? (
          <button
            onClick={handleInstallAndroid}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: "#7c3aed",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Instalar
          </button>
        ) : (
          <button
            onClick={() => setIosModalOpen(true)}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: "#7c3aed",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Como instalar
          </button>
        )}

        <button
          onClick={dismiss}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.45)",
            fontSize: 18,
            cursor: "pointer",
            padding: "4px 6px",
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>

      {/* Modal iOS */}
      {iosModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setIosModalOpen(false); }}
        >
          <div style={{
            width: "100%",
            maxWidth: 420,
            background: "#111111",
            borderRadius: 20,
            border: "1px solid #2a2a2a",
            padding: 20,
            marginBottom: 60,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>
                Instalar DoramasPlus
              </div>
              <button
                onClick={() => setIosModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                {
                  num: "1",
                  icon: "⬆",
                  text: <>Toque no botão <b style={{ color: "#fff" }}>Compartilhar</b> (ícone de caixa com seta) na barra do Safari</>,
                },
                {
                  num: "2",
                  icon: "➕",
                  text: <>Role para baixo e toque em <b style={{ color: "#fff" }}>"Adicionar à Tela de Início"</b></>,
                },
                {
                  num: "3",
                  icon: "✅",
                  text: <>Toque em <b style={{ color: "#fff" }}>"Adicionar"</b> para confirmar</>,
                },
              ].map(({ num, icon, text }) => (
                <div key={num} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    background: "#7c3aed",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 14,
                    flexShrink: 0,
                  }}>
                    {num}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 1.45, paddingTop: 6 }}>
                    {icon} {text}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={dismiss}
              style={{
                marginTop: 20,
                width: "100%",
                padding: "12px",
                borderRadius: 12,
                border: "1px solid #2a2a2a",
                background: "transparent",
                color: "rgba(255,255,255,0.5)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
