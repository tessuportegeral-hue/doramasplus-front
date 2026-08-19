---
name: deploy-edge
description: Protocolo seguro pra editar/deployar edge function do Supabase — evita os 3 acidentes já quase cometidos (editar versão velha, verify_jwt trocado no redeploy, placeholder em prod)
---

# Deploy seguro de edge function

Seguir SEMPRE que for editar qualquer função em `supabase/functions/`. Cada regra aqui existe porque o erro quase aconteceu de verdade.

## Antes de editar

1. **`mcp__supabase__get_edge_function` PRIMEIRO, sempre.** O repo local vive ATRASADO em relação à prod (aconteceu com dora-chat, business-metrics-report, salesbot, emails…). Editar em cima do arquivo do repo sem conferir = risco de apagar feature que só existe em prod.
2. Anotar da resposta: **`version` atual** e **`verify_jwt` atual** (campo no metadata).
3. Se o repo divergir da prod: espelhar a prod no repo antes, commitar como "repo espelha prod", e SÓ ENTÃO aplicar a mudança nova por cima.
4. **Função de pagamento** (asaas, infinitepay, stripe, checkout, webhook): NÃO mexer sem autorização explícita do Stefano — regra do CLAUDE.md.

## No deploy

5. Deploy via `mcp__supabase__deploy_edge_function` com o conteúdo COMPLETO do arquivo (nunca trecho/placeholder — placeholder já quase foi pra prod uma vez).
6. **`verify_jwt` EXPLÍCITO com o valor original.** O default do MCP é `true` — redeployar função pública (webhook, cron) sem passar `verify_jwt: false` QUEBRA ela silenciosamente (todo request vira 401).

## Depois do deploy

7. **Verificação byte a byte**: `get_edge_function` de novo e conferir que o conteúdo em prod é exatamente o que era pra ser (diff mental ou hash). Conferir que `version` incrementou.
8. **Health-check**: chamar a função do jeito mais barato possível (OPTIONS, ou request de preview/teste) e conferir resposta esperada — pra função de email, usar o gate de teste (`*_TEST_EMAIL`, duas camadas) e mandar só pro email de teste primeiro.
9. **Espelhar no repo**: o arquivo em `supabase/functions/<slug>/index.ts` deve ficar idêntico ao que foi deployado; commit + push (autorização permanente de push).
10. Se a função roda por cron: conferir no próximo ciclo que rodou (logs via `mcp__supabase__query_logs`) — falha de cron já foi silenciosa por dias.

## Referências rápidas

- Projeto: fbngdxhkaueaolnyswgn (sa-east-1). Functions URL: `https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/<slug>`.
- Edge function não aguenta imagem grande em memória (imagescript) — montagem de imagem fora do caminho quente.
- `functions.invoke()` no front sem header Authorization manda anon key = 401 (bug clássico já corrigido).
