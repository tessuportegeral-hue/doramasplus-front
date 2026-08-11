import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { reportWebVitals } from '@/lib/reportWebVitals';

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);

// ✅ 11/08 — coleta CLS/LCP/INP dos usuários reais (com o elemento culpado +
// tipo de conexão) pra enxergar o problema de campo em horas, não nos 28 dias
// do Google. Fora do render, fire-and-forget, nunca afeta a UI.
reportWebVitals();