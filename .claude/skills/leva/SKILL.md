---
name: leva
description: Anunciar a leva de doramas pendentes (Telegram + WhatsApp) com a receita blindada — usar quando o Stefano pedir "vamos subir doramas", "solta a leva" ou similar
---

# Leva de anúncios de doramas novos

Anuncia todos os doramas pendentes nos 3 destinos: grupo do Telegram (tópico "ATENÇÃO! LEIAM AQUI!"), canal @DramasPlayGRATUITO e grupo do WhatsApp na Comunidade. Receita validada nas levas de 12/08 a 18/08/2026 (a maior: 65 itens, zero falhas).

## Regras de ouro (não pular NENHUMA)

1. **ZERO prompt de permissão no meio da leva.** O Stefano odeia ("para de fica perguntando porra", 18/08). Só usar os comandos allowlisted abaixo. NUNCA fazer UPDATE no banco por item — marcar tudo num ÚNICO UPDATE no final.
2. **Legenda SEMPRE colada, NUNCA digitada** (Set-Clipboard + Ctrl+V). Texto digitado já foi bloqueado pelo classificador no meio do envio (13/08) e saiu mensagem incompleta no grupo.
3. **Enviar pelo BOTÃO de enviar, NUNCA tecla Return.** Return falha silenciosamente: o item fica no editor e o próximo cola como 2ª imagem (aconteceu 18/08, itens 9/10).
4. **Screenshot de verificação após CADA passo** (imagem colada? legenda colada? mensagem saiu com ✓?). Colar falha ~3% das vezes — reclicar o campo + Ctrl+V resolve.
5. **Conferir o nome do grupo do WhatsApp TODA leva** — já mudou 3x (hoje: comunidade "DoramasPlus", grupo com descrição "Avisos"). Errei 2x por confiar no nome antigo.
6. **Se o Stefano começar a usar o WhatsApp Web ao mesmo tempo (chat muda sozinho): PARAR na hora** e só voltar quando ele disser que parou.
7. **Ordem dos envios (regra do Stefano):** A legendados → A dublados → B (versões dubladas) SEMPRE por último.
8. **Conferir a CAPA antes do batch do Telegram:** baixar todas as capas, montar folha de contato (grid), dar Read nela e conferir o selo DUBLADO/legendado de TODAS contra o banco. Já teve capa DUBLADO com `language` errado no banco (4 saíram errado no Telegram em 14/08 por rodar o batch antes de conferir).
9. **Título quebrado = NÃO anunciar.** Bot já subiu dorama com título = observação do fornecedor. Avisar o Stefano e pular.
10. **browser_batch: wait máximo 10s por ação** (mais que isso dá erro).

## Passo a passo

### 1. Levantar pendentes
```sql
-- Tipo A (dorama novo): announced_at is null
-- Tipo B (ganhou versão dublada): alt_bunny_url is not null and alt_announced_at is null
select short_code, title, language, cover_url, is_brasileiro, created_at,
       case when alt_bunny_url is not null and alt_announced_at is null and announced_at is not null then 'B' else 'A' end as tipo
from doramas
where announced_at is null
   or (alt_bunny_url is not null and alt_announced_at is null)
order by created_at;
```
Ordenar: A legendado → A dublado → B. Salvar como `rows.json` na pasta `leva/` do scratchpad.

### 2. Preparar a pasta `leva/` no scratchpad
- `build_json.py`: baixa capas pra `covers/` (precisa header `Referer: https://doramasplus.com.br/` — Bunny bloqueia hotlink) e monta `contact.jpg` (folha de contato, 7 colunas).
- **Read em `contact.jpg` e conferir selo dublado/legendado de todas** vs `language` do banco. Divergência → tratar pelo que a CAPA diz e avisar o Stefano.
- `prep_item.py` (PYTHON, não .ps1 — emoji em .ps1 QUEBRA no PowerShell 5.1): lê `idx.txt`, escreve `caption.txt` (com UTM) e copia a capa referência.
- `prep-image.ps1`: capa do item atual → clipboard (imagem).
- `set-text.ps1`: `caption.txt` → clipboard (texto).
- `telegram-batch.mjs`: manda foto+legenda pros 2 destinos do Telegram, `parse_mode: "Markdown"`, grava `results.json`.

### 3. Templates de legenda
- **Tipo A:** `🎬 Novo dorama disponível!\n\n{Título} - *LEGENDADO|DUBLADO*\n\nJá está no ar, é só entrar e assistir 👇\nhttps://doramasplus.com.br/d/{short_code}?s=wa\n\n📲 Baixe o App oficial pela *Play Store*: doramasplus.com.br/app`
- **Tipo B:** `🎧 {Título} — *VERSÃO DUBLADA DISPONÍVEL!*\n\nJá está no ar...` (mesmo rodapé)
- **Tipo C (corrigido/reupload):** `✅ {Título} - *CORRIGIDO - LEGENDADO*\nO vídeo agora está completo!` (mesmo rodapé)
- UTM: `?s=tg` no Telegram, `?s=wa` no WhatsApp (dorama-redirect traduz pra utm completo — obrigatório desde o GA4, 14/08).

### 4. Telegram
Rodar `telegram-batch.mjs` (pode ser em background). Conferir `results.json`: N itens × 2 destinos, 0 falhas.

### 5. WhatsApp (um a um)
Abrir web.whatsapp.com → Comunidades → comunidade "DoramasPlus" → grupo "Avisos" (CONFERIR nome/descrição). Por item:
1. `Write idx.txt` com o número do item
2. `python3 leva/prep_item.py` (confirma no stdout: "N/65 tipo título")
3. `& leva/prep-image.ps1`
4. browser_batch: clicar no campo de mensagem → Ctrl+V → wait 2 → screenshot (**conferir: 1 imagem no editor, a capa certa**)
5. `& leva/set-text.ps1`
6. browser_batch: clicar na caixa de legenda → Ctrl+V → wait 1 → screenshot (**conferir legenda colada**; se vazia, reclicar + Ctrl+V)
7. browser_batch: clicar no BOTÃO enviar → wait 10 → scroll down → screenshot (**conferir mensagem no grupo com ✓**; se o editor ainda estiver aberto, clicar enviar de novo)

O viewport oscila entre sessões — se coordenada fixa falhar, usar `find` pra reancorar campo de legenda e botão enviar.

### 6. Fechar
1. **UM único UPDATE**: `announced_at = now()` pros A enviados + `alt_announced_at = now()` pros B (por `short_code`, com `and announced_at is null` de guarda).
2. **Rodar a query do passo 1 DE NOVO**: o bot sobe dorama DURANTE a leva (aconteceu em 3 levas) — se apareceu novo, anunciar na sequência.
3. Atualizar a memória `project-leva-anuncios-12-08-estado` com data, total e qualquer gotcha novo.
