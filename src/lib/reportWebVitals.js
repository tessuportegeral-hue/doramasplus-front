// ✅ 11/08 — telemetria de Core Web Vitals dos usuários REAIS, pra enxergar
// CLS/LCP/INP de campo em HORAS (não nos 28 dias do CrUX) e — o principal —
// saber o ELEMENTO exato do DOM que causou cada shift, junto do tipo de
// conexão (o CLS ruim do site é específico de rede/aparelho lento).
//
// Usa web-vitals/attribution: a mesma medição que o Chrome/CrUX faz, mas com
// o "porquê" anexado. Grava em public.web_vitals_events (RLS: anon só INSERT).
// Fire-and-forget: nunca trava nem quebra a página se o insert falhar.
import { onCLS, onLCP, onINP, onFCP, onTTFB } from 'web-vitals/attribution';
import { supabase } from '@/lib/supabaseClient';

// Path sem query string — nunca queremos PII em URL (ver regra de privacidade).
function currentPath() {
  try {
    return window.location.pathname || '/';
  } catch {
    return null;
  }
}

// ✅ 12/08 (v3) — histórico das trocas de rota do SPA, pra cruzar com o
// horário do maior shift e responder de vez: "o CLS é uma troca de página?"
// (tese: no celular lento a troca acontece >500ms depois do toque e o
// Chrome conta como shift da página de ENTRADA). App.jsx chama
// noteRouteChange a cada navegação.
const navHistory = [];
export function noteRouteChange(from, to) {
  try {
    navHistory.push({ at: Math.round(performance.now()), from, to });
    if (navHistory.length > 30) navHistory.shift();
  } catch {
    /* nunca quebra a página */
  }
}

// path da ENTRADA (o que o CrUX usa como chave da página; currentPath() na
// hora do envio pode já ser outra rota)
let LANDING_PATH = null;
try {
  LANDING_PATH = window.location.pathname || '/';
} catch {
  /* ignore */
}

// ✅ 13/08 (v6) — três furos da v5 fechados:
// (1) Só gravávamos sources[0] = a VÍTIMA (o elemento que mais se moveu).
//     O elemento INSERIDO/removido que CAUSA o shift costuma estar na lista
//     entry.sources (até 5 por entry). Agora gravamos todos.
// (2) O scrollY era lido no callback do PerformanceObserver, que em aparelho
//     lento roda BEM depois do shift — dado não confiável. Agora gravamos
//     também há quantos ms foi o último input do usuário ANTES do shift
//     (si) — shift logo depois de digitar/tocar = interação, não load.
// (3) Não dava pra saber se a BUSCA estava ativa na hora (os `!normalizedQuery`
//     desmontam banner+hero+seções a cada letra — suspeita nº 11). O Dashboard
//     agora reporta liga/desliga da busca e cada troca de branch das seções
//     (skeleton/erro/vazio/fileira/desmontou) via noteSearchState/
//     noteSectionState, e o evento de CLS leva esse diário junto.

// Últimos inputs do usuário (timestamps performance.now) — ring buffer.
const inputTimes = [];
try {
  const markInput = () => {
    inputTimes.push(performance.now());
    if (inputTimes.length > 30) inputTimes.shift();
  };
  for (const ev of ['pointerdown', 'keydown', 'input']) {
    window.addEventListener(ev, markInput, { passive: true, capture: true });
  }
} catch {
  /* ignore */
}
// último input ANTES de um instante t (não o último absoluto — o callback
// atrasa e um toque posterior contaminaria a leitura)
function msSinceInputBefore(t) {
  for (let i = inputTimes.length - 1; i >= 0; i--) {
    if (inputTimes[i] <= t) return Math.round(t - inputTimes[i]);
  }
  return null;
}

// Busca ativa? (histórico de liga/desliga, pra casar com o t de cada shift)
const searchLog = [];
export function noteSearchState(active) {
  try {
    const last = searchLog[searchLog.length - 1];
    if (last && last.on === !!active) return;
    searchLog.push({ at: Math.round(performance.now()), on: !!active });
    if (searchLog.length > 20) searchLog.shift();
  } catch {
    /* nunca quebra a página */
  }
}
function searchActiveAt(t) {
  for (let i = searchLog.length - 1; i >= 0; i--) {
    if (searchLog[i].at <= t) return searchLog[i].on;
  }
  return false;
}

// Diário de branch das seções da home (skeleton/error/null/rows/gone) e do
// hero (loading/null/ready) — quem desmontou/remontou, e quando.
const sectionLog = [];
export function noteSectionState(id, state) {
  try {
    sectionLog.push({ at: Math.round(performance.now()), id, s: state });
    if (sectionLog.length > 60) sectionLog.shift();
  } catch {
    /* nunca quebra a página */
  }
}

function selFor(node) {
  try {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return null;
    const own = el.id ? `#${el.id}` : String(el.className || '').slice(0, 40);
    let p = el.parentElement;
    while (p && !p.id) p = p.parentElement;
    return (p && p.id ? `#${p.id} >> ` : '') + (own || '?');
  } catch {
    return null;
  }
}

// ✅ 12/08 (v4) — diário dos maiores shifts da sessão. Guarda os 10 maiores;
// o envio anexa os 5 primeiros.
const bigShifts = [];
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput || entry.value < 0.05) continue;
      const sources = (entry.sources || []).slice(0, 5);
      const src = sources[0];
      const node = src?.node;
      bigShifts.push({
        t: Math.round(entry.startTime),
        v: Math.round(entry.value * 1000) / 1000,
        scrollY: Math.round(window.scrollY || 0),
        ih: window.innerHeight || null,
        si: msSinceInputBefore(entry.startTime),
        sa: searchActiveAt(entry.startTime),
        tag: node?.tagName || null,
        sel: selFor(node),
        py: src ? Math.round(src.previousRect.top) : null,
        cy: src ? Math.round(src.currentRect.top) : null,
        ph: src ? Math.round(src.previousRect.height) : null,
        ch: src ? Math.round(src.currentRect.height) : null,
        // v6: TODOS os sources do entry (o insersor costuma estar aqui)
        srcs: sources.map((s) => ({
          sel: selFor(s?.node),
          py: Math.round(s.previousRect.top),
          cy: Math.round(s.currentRect.top),
          ph: Math.round(s.previousRect.height),
          ch: Math.round(s.currentRect.height),
          pw: Math.round(s.previousRect.width),
          cw: Math.round(s.currentRect.width),
        })),
      });
      bigShifts.sort((a, b) => b.v - a.v);
      if (bigShifts.length > 10) bigShifts.length = 10;
    }
  }).observe({ type: 'layout-shift', buffered: true });
} catch {
  /* navegador sem layout-shift API — segue sem o diário */
}

// Logado ou visitante? (leitura síncrona do storage do supabase — não dá
// pra usar o client aqui sem criar dependência circular)
function isLoggedSync() {
  try {
    // ⚠️ 13/08 — chave corrigida: customSupabaseClient define
    // storageKey "sb-auth-token" (não o padrão sb-<ref>-auth-token).
    // Todos os `logged` gravados até 13/08 ~15h UTC estão ERRADOS (false
    // até pra logado) — não comparar com dados antigos.
    return !!localStorage.getItem('sb-auth-token');
  } catch {
    return null;
  }
}

function connEffectiveType() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return c?.effectiveType || null; // '4g' | '3g' | '2g' | 'slow-2g'
  } catch {
    return null;
  }
}

// Extrai o "culpado" e alguns extras úteis por tipo de métrica. Os campos de
// attribution variam por métrica (largestShiftTarget pra CLS, element pro LCP,
// interactionTarget pro INP) — normalizamos num alvo + um jsonb de detalhe.
function extractAttribution(name, attribution) {
  if (!attribution) return { target: null, detail: null };

  if (name === 'CLS') {
    // ✅ 11/08 (v2) — guarda o retângulo ANTES/DEPOIS do elemento que mais
    // deslocou. É isso que revela se ele CRESCEU (dH>0, mudou de altura) ou só
    // FOI EMPURRADO (dH~0, dY>0, vítima de algo acima). Sem isso a gente fica
    // chutando qual é a fonte real do shift.
    const src = attribution.largestShiftSource;
    const pr = src?.previousRect;
    const cr = src?.currentRect;

    // ✅ 12/08 (v3) — qual foi a ÚLTIMA troca de rota ANTES do maior shift,
    // e há quantos ms. navDeltaMs pequeno (< ~2000) = o shift É a troca de
    // página; null/grande = o shift é do próprio carregamento da página.
    const shiftTime = attribution.largestShiftTime ?? null;
    let navBefore = null;
    if (shiftTime != null) {
      for (let i = navHistory.length - 1; i >= 0; i--) {
        if (navHistory[i].at <= shiftTime) {
          navBefore = navHistory[i];
          break;
        }
      }
    }

    return {
      target: attribution.largestShiftTarget || null,
      detail: {
        largestShiftValue: attribution.largestShiftValue ?? null,
        loadState: attribution.loadState ?? null,
        largestShiftTime: shiftTime,
        srcTag: src?.node ? (src.node.tagName || src.node.nodeName || null) : null,
        prevH: pr ? Math.round(pr.height) : null,
        curH: cr ? Math.round(cr.height) : null,
        prevY: pr ? Math.round(pr.top) : null,
        curY: cr ? Math.round(cr.top) : null,
        landingPath: LANDING_PATH,
        navBeforeShiftMs: navBefore ? Math.round(shiftTime - navBefore.at) : null,
        navBeforeShift: navBefore ? `${navBefore.from} -> ${navBefore.to}` : null,
        logged: isLoggedSync(),
        // os 5 maiores shifts da sessão, cada um com scrollY na hora — v4
        shifts: bigShifts.slice(0, 5),
        // v6: diário de busca e de branch das seções — cruzar o `at` de cada
        // troca com o `t` dos shifts responde QUEM desmontou/remontou antes.
        searchLog: searchLog.slice(-8),
        sectionLog: sectionLog.slice(-25),
      },
    };
  }
  if (name === 'LCP') {
    return {
      target: attribution.element || null,
      detail: {
        url: attribution.url ? String(attribution.url).slice(0, 300) : null,
        timeToFirstByte: attribution.timeToFirstByte ?? null,
        resourceLoadDelay: attribution.resourceLoadDelay ?? null,
        elementRenderDelay: attribution.elementRenderDelay ?? null,
      },
    };
  }
  if (name === 'INP') {
    return {
      target: attribution.interactionTarget || null,
      detail: {
        interactionType: attribution.interactionType ?? null,
        inputDelay: attribution.inputDelay ?? null,
        processingDuration: attribution.processingDuration ?? null,
        presentationDelay: attribution.presentationDelay ?? null,
      },
    };
  }
  return { target: null, detail: null };
}

function send(metric) {
  try {
    const { target, detail } = extractAttribution(metric.name, metric.attribution);
    const row = {
      metric: metric.name,
      value: metric.value,
      rating: metric.rating || null,
      page_path: currentPath(),
      attribution_target: target ? String(target).slice(0, 500) : null,
      attribution_detail: detail,
      is_mobile: typeof window !== 'undefined' ? window.innerWidth < 768 : null,
      viewport_w: typeof window !== 'undefined' ? window.innerWidth : null,
      effective_type: connEffectiveType(),
      navigation_type: metric.navigationType || null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      // ✅ 12/08 — commit do bundle que gerou o evento (vem do define no
      // vite.config.js). Essencial: o relatório de CLS chega na SAÍDA da
      // página, então filtrar por created_at mistura aba velha com código
      // novo — só o carimbo separa direito um deploy do outro.
      app_version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null,
    };

    // Fire-and-forget. Nunca await, nunca deixa erro subir.
    supabase
      .from('web_vitals_events')
      .insert(row)
      .then(() => {})
      .catch(() => {});
  } catch {
    /* telemetria nunca pode quebrar a página */
  }
}

let started = false;
export function reportWebVitals() {
  if (started) return;
  started = true;
  try {
    // CLS/LCP/INP são o que importa pra SEO/UX; FCP/TTFB entram de brinde pra
    // contexto. Cada callback dispara quando a métrica fica "final" (CLS e INP
    // ao esconder a aba; LCP quando o maior elemento se estabiliza).
    onCLS(send);
    onLCP(send);
    onINP(send);
    onFCP(send);
    onTTFB(send);
  } catch {
    /* se a lib não carregar, o resto do site segue normal */
  }
}
