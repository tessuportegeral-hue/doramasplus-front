// src/components/RequirePhoneGate.jsx
//
// DESATIVADO (2026-07-11): o gate de tela cheia que exigia o WhatsApp de quem
// não tinha número salvo (usuários antigos) era intrusivo demais. Agora o
// componente apenas deixa passar — não checa nada nem mostra modal.
//
// O cadastro novo (Signup) continua coletando o telefone normalmente; isto aqui
// só removia a cobrança retroativa. Para reativar, veja o histórico do git.
export default function RequirePhoneGate({ children }) {
  return children;
}
