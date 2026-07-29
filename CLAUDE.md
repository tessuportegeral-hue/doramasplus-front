# DoramasPlus — Contexto do Projeto

## O que é
Plataforma brasileira de streaming de doramas (séries asiáticas).
Site: https://doramasplus.com.br

## Stack
- React 18 + Vite
- TailwindCSS
- Supabase (projeto: fbngdxhkaueaolnyswgn, região sa-east-1)
- React Router DOM v6
- Framer Motion
- Stripe + InfinityPay (PIX)
- Deploy: Vercel (via GitHub)

## Estrutura principal
- `src/pages/` — páginas do app
- `src/components/` — componentes reutilizáveis
- `src/contexts/SupabaseAuthContext.jsx` — autenticação e premium
- `src/hooks/useSessionGuard.js` — trava de sessão única (aposentada, ver abaixo)
- `src/lib/customSupabaseClient.js` — cliente Supabase
- `src/lib/supabaseClient.js` — re-exporta o customSupabaseClient
- `supabase/functions/claim-playback/` — controle de streams simultâneos (a trava de verdade hoje)

## Banco de dados (tabelas principais)
- `profiles` — dados dos usuários
- `subscriptions` — assinaturas (Stripe + PIX manual); `max_concurrent_streams` controla quantos streams simultâneos o plano permite (hoje 1 pra todo mundo)
- `doramas` — catálogo de doramas
- `active_sessions` — controle de sessão única (aposentado 29/07, ver abaixo)
- `playback_sessions` — dispositivo(s) assistindo agora de verdade (usado pelo `claim-playback`)
- `playback_switch_log` — auditoria de troca/força de dispositivo no `claim-playback`
- `watch_history` — progresso de assistir
- `pix_payments` — pagamentos PIX

## Regras importantes
- NUNCA mexer em arquivos sem ser solicitado
- NUNCA fazer git push por conta própria (sem pedido ou pergunta antes) — mas quando o usuário pedir commit, ou eu perguntar "quer que eu commite?" e ele confirmar, faz commit + push juntos numa ação só (não separar em duas confirmações)
- NUNCA alterar lógica de pagamento sem autorização
- Sempre testar mudanças no usuário `tesagencia@gmail.com` antes de abrir para todos
- O admin do sistema é `tessuportegeral@gmail.com`

## Controle de dispositivo/reprodução (modelo "Netflix", desde 29/07/2026)
- **Login é livre em quantos dispositivos quiser** — sem bloqueio, sem modal, sem derrubar ninguém. A trava de sessão única (`active_sessions`, `useSessionGuard`) foi aposentada de vez pra todo mundo (`ENABLE_SINGLE_SESSION = false` em `SupabaseAuthContext.jsx`; `shouldCheckSingleSession` sempre `false` em `Login.jsx`; `useSessionGuard(false)` em `DoramaWatch.jsx`). Não reativar sem repensar o fluxo todo.
- **A trava de verdade é na hora de ASSISTIR**, via edge function `claim-playback` (usa `playback_sessions` + `subscriptions.max_concurrent_streams`, hoje 1 por conta). Quando bate no limite, aparece um botão ("Limite de Reprodução? Clique aqui para resolver") que força entrada e derruba o(s) outro(s) dispositivo(s) — `DoramaWatch.jsx`, efeito "CLAIM-PLAYBACK".
- Device ID persiste em `localStorage.dp_device_id` por navegador (estável entre recargas, mas dois navegadores diferentes na mesma máquina contam como dispositivos separados).
- Heartbeat: 6s pra todo mundo, 3s só pra `tesagencia@gmail.com` (`SHARP_TEST_EMAIL` dentro de `claim-playback/index.ts`) — testar mudanças de timing nela antes de abrir geral, mesma regra de sempre.
- Pendente: quando ativarem plano de 3 dispositivos (`max_concurrent_streams = 3`), decidir a regra de qual dispositivo cai quando o 4º força entrada — hoje a função pega os "outros" sem nenhum `ORDER BY` (ordem arbitrária), só funciona certo hoje porque o limite é 1.
- Achado 29/07: `claim-playback` não existia no repo local antes (só deployada) — sempre conferir `mcp__supabase__list_edge_functions`/`get_edge_function`, não só grep no repo, antes de assumir que uma tabela/função tá "órfã".
