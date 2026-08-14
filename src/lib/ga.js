// Google Analytics 4 (14/08/2026) — instalado do jeito PERFORMÁTICO.
//
// Lição do fbevents (LoAF pegou o pixel cobrando 60-280ms por clique):
// script de terceiro NUNCA entra no caminho crítico. Aqui o stub do gtag
// existe desde o 1º momento (eventos enfileiram no dataLayer, nada se
// perde), mas o script de verdade só é injetado depois do load + idle —
// fora da janela que o LCP/INP medem.
//
// SPA: page_view manual a cada troca de rota (send_page_view: false no
// config pra não duplicar o primeiro).
const GA_ID = 'G-N2L4B9E2LK';

export function gaInit() {
  try {
    if (typeof window === 'undefined' || window.__dp_ga_init) return;
    window.__dp_ga_init = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { send_page_view: false });

    const inject = () => {
      try {
        if (document.getElementById('dp-ga')) return;
        const s = document.createElement('script');
        s.async = true;
        s.id = 'dp-ga';
        s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
        document.head.appendChild(s);
      } catch {}
    };
    const onIdle = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(inject, { timeout: 4000 });
      } else {
        setTimeout(inject, 2500);
      }
    };
    if (document.readyState === 'complete') onIdle();
    else window.addEventListener('load', onIdle, { once: true });
  } catch {
    /* analytics nunca pode quebrar a página */
  }
}

// Evento de conversão/funil (sign_up, purchase...) — enfileira no stub se o
// script ainda não chegou, nada se perde.
export function gaEvent(name, params) {
  try {
    if (typeof window === 'undefined' || !window.gtag) return;
    window.gtag('event', name, params || {});
  } catch {
    /* analytics nunca pode quebrar a página */
  }
}

export function gaPageView(path) {
  try {
    if (typeof window === 'undefined' || !window.gtag) return;
    window.gtag('event', 'page_view', {
      page_path: path,
      page_location: window.location.href,
      page_title: document.title,
    });
  } catch {
    /* idem */
  }
}
