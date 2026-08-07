import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/SupabaseAuthContext";

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && "ontouchend" in document)
  );
}

function isAndroidMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

// ✅ 28/07: navegador comum não sabe que o app já tá instalado no aparelho
// (isso só é visível de dentro do app, via isInStandaloneMode). Usa a API
// do Chrome/Android que consulta o pacote declarado em related_applications
// do manifest.json contra o Google Play de verdade.
async function isRelatedAppInstalled() {
  if (typeof navigator === "undefined" || !navigator.getInstalledRelatedApps) return false;
  try {
    const apps = await navigator.getInstalledRelatedApps();
    return apps.length > 0;
  } catch {
    return false;
  }
}

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";

// ✅ 05/08: o app de verdade (TWA instalado via Play Store) sempre abre com
// esse referrer — é o único jeito confiável de diferenciar ele do atalho
// antigo de "adicionar à tela de início" (que também cai em
// display-mode:standalone, mas nunca tem esse referrer).
function isRealNativeApp() {
  if (typeof document === "undefined") return false;
  return document.referrer.startsWith("android-app://br.com.doramasplus.twa");
}

export default function InstallAppBanner() {
  // ✅ 07/08 — pro usuário logado, o banner do rodapé some (a barra
  // inferior nova ocupa o mesmo espaço). Testado com tesagencia antes;
  // liberado geral em 07/08.
  const { isAuthenticated } = useAuth();
  const hideForBottomNav = isAuthenticated;
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIOS, setShowIOS] = useState(false);
  const [iosModalOpen, setIosModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (isInStandaloneMode()) {
      // ✅ 05/08: pouca adesão ao app do Play Store vinha desse atalho
      // antigo confundindo — quem tinha adicionado à tela antes do fix de
      // 27/07 nunca via nenhum aviso pra baixar o app de verdade, porque
      // essa checagem parava aqui sem diferenciar os dois. Só Android:
      // bloqueia esse atalho velho e manda direto pro Play Store. iPhone
      // não tem app nativo, continua sem mexer.
      if (isAndroidMobile() && !isRealNativeApp()) {
        window.location.replace(PLAY_STORE_URL);
      }
      return;
    }

    if (isIOS()) {
      setShowIOS(true);
      return;
    }

    // ✅ 27/07: Android de celular/tablet manda direto pra Play Store (app
    // oficial, assetlinks.json corrigido). PC/desktop usa o beforeinstallprompt
    // do Chrome — instala como app no computador, não tem Play Store lá.
    if (isAndroidMobile()) {
      isRelatedAppInstalled().then((alreadyInstalled) => {
        if (cancelled || alreadyInstalled) return;
        setShowAndroid(true);
      });
      return () => {
        cancelled = true;
      };
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowAndroid(true);
    };
    const onInstalled = () => setShowAndroid(false);

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const visible = (showAndroid || showIOS) && !hideForBottomNav;

  // ✅ 27/07: o botão flutuante da Dora (bottom:24px, zIndex:9999) ficava por
  // cima/colado nesse banner (bottom:0, ~64px de altura, zIndex:9990) — os
  // dois são "position: fixed" independentes, sem noção um do outro. Em vez
  // de acoplar os componentes, o banner publica sua altura numa CSS var
  // global; DoramasChat.jsx soma essa var no próprio "bottom". Zera a var
  // quando o banner não está visível.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--dp-install-banner-h",
      visible ? "64px" : "0px"
    );
    return () => document.documentElement.style.setProperty("--dp-install-banner-h", "0px");
  }, [visible]);

  function dismiss() {
    setShowAndroid(false);
    setShowIOS(false);
    setIosModalOpen(false);
  }

  async function handleInstallAndroid() {
    // Android de celular/tablet: sempre Play Store, não tem prompt nativo.
    if (isAndroidMobile()) {
      window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
      return;
    }

    // Desktop: usa o prompt nativo do Chrome (beforeinstallprompt) — se por
    // algum motivo não disparou ainda, cai pra Play Store como alternativa.
    if (!deferredPrompt) {
      window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
    setDeferredPrompt(null);
    setShowAndroid(false);
  }

  if (!visible) return null;

  return (
    <>
      {/* Banner fixo no rodapé */}
      <div style={{
        position: "fixed",
        bottom: "var(--dp-bottom-nav-h, 0px)",
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
            {showAndroid && isAndroidMobile()
              ? "Baixe o app oficial no Google Play"
              : "Adicione à tela inicial para acesso rápido"}
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
