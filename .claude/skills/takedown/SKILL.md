---
name: takedown
description: Retirada completa de dorama(s) do ar por pedido jurídico/extrajudicial (C&D, DMCA) ou decisão preventiva — banco, Bunny Stream, Bunny Storage, purge CDN e log de auditoria
---

# Retirada de dorama do ar (takedown)

Processo validado em 18/08/2026 (C&D da DramaShorts: 1 título exigido + 12 preventivos, todos verificados 404). Ordem importa: **snapshot ANTES de apagar qualquer coisa**.

## Regras de ouro

1. **Preservar provas.** Cartas C&D normalmente exigem preservação de registros — NUNCA apagar logs, `content_takedowns`, e-mails ou histórico. A retirada é do CONTEÚDO, não das evidências.
2. **NUNCA re-subir título que foi alvo de carta** — com carta na mão, re-upload = infração dolosa (willful, até US$150k/obra nos EUA). Se o Stefano pedir, avisar disso explicitamente antes.
3. **Slug é linha vermelha em TODO o resto do site** — a retirada deleta o dorama alvo, mas nenhum slug de outro dorama pode ser tocado. Dizer explicitamente "nenhum outro slug mudou" no final.
4. **Chaves do Bunny nunca saem do navegador.** Operações na API do Bunny rodam via fetch de DENTRO do painel dash.bunny.net logado (CORS liberado lá).
5. Responder ao notificante é decisão do STEFANO (ele responde curto, só confirmando remoção — decisão dele de 18/08, respeitar).

## Infra (referência)

- **Bunny Stream**: library 549745 ("Dorma") — vídeos com renditions. GUID vem de `doramas.bunny_url` / `alt_bunny_url`.
- **Bunny Storage**: zone `doramasplus` (id 1280040, endpoint `https://br.storage.bunnycdn.com/doramasplus`) — MP4/MOV ORIGINAIS de todos os doramas (~6 TB).
- **CDN**: `doramasplus.b-cdn.net`. Purge em dash.bunny.net/purge.
- Tabela de log: `content_takedowns` (RLS, só service role) — snapshot completo da linha do dorama + motivo + datas.

## Passo a passo

1. **Identificar** o(s) dorama(s): id, slug, title, bunny_url, alt_bunny_url, cover_url. Se o pedido cita URL/título em inglês, procurar também por similaridade (pg_trgm) e título EN contido.
2. **Snapshot** → `insert into content_takedowns` com a linha inteira do dorama (jsonb), motivo (quem pediu, data, referência da carta) e `requested_at`.
3. **Delete no banco** → `delete from doramas where id = ...` (favorites/watch_history cascateiam). Conferir que a página `/dorama/{slug}` responde 404 pra bot (dynamic rendering).
4. **Bunny Stream** → apagar o(s) GUID(s) (inclusive o alt) via API de dentro do painel:
   `fetch('https://video.bunnycdn.com/library/549745/videos/{guid}', {method:'DELETE', headers:{AccessKey: <key da library, já no painel>}})`
5. **Bunny Storage** → apagar o(s) arquivo(s) originais (nome vem do path em `bunny_url`/`alt_bunny_url`):
   `fetch('https://br.storage.bunnycdn.com/doramasplus/{arquivo}', {method:'DELETE', headers:{AccessKey: <key da zone>}})`
6. **Purge CDN** em dash.bunny.net/purge — URL exata; se o nome do arquivo tem espaço/vírgula, usar curinga (`Cold*`).
7. **Verificar 404** na CDN (com Referer do site) e no site (`/dorama/{slug}`).
8. **Fechar o log** → `update content_takedowns set removed_from_bunny_at = now() where ...`.
9. Confirmar pro Stefano: lista do que saiu, onde saiu (banco/Stream/Storage/CDN), e "nenhum outro slug mudou".

## Depois

- Se foi carta formal: lembrar o Stefano do prazo de resposta (geralmente 24-72h) — a resposta é dele.
- Atualizar a memória `project-dramashorts-takedown-2026-08-18` (ou criar nova) com o caso.
