import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { reportWebVitals } from '@/lib/reportWebVitals';

// ✅ 13/08 (LCP) — o LCP da home é a imagem do hero, e a telemetria mostrou
// 1,7s (p75) de resourceLoadDelay: o browser só descobre a URL depois de
// JS + React + fetch no Supabase. O HeroSection salva a URL do 1º banner em
// localStorage; aqui, ANTES do React montar, a gente injeta um preload —
// na visita seguinte a imagem já está baixando junto com o bundle. Se o
// destaque mudou, o custo é um download extra; o comum é acertar.
// Só no mobile/tela estreita, que é onde o LCP sofre e o banner aparece.
try {
  const heroUrl = localStorage.getItem('dp_last_hero_url');
  if (heroUrl && window.innerWidth < 768) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = heroUrl;
    link.fetchPriority = 'high';
    document.head.appendChild(link);
  }
} catch {
  /* nunca atrapalha o boot */
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);

// ✅ 11/08 — coleta CLS/LCP/INP dos usuários reais (com o elemento culpado +
// tipo de conexão) pra enxergar o problema de campo em horas, não nos 28 dias
// do Google. Fora do render, fire-and-forget, nunca afeta a UI.
reportWebVitals();