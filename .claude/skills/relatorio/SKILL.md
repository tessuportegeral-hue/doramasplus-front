---
name: relatorio
description: Disparar o relatório de negócio (business-metrics-report) na hora, sem esperar o cron das 9h — diário, semanal ou mês fechado — e resumir os números no chat
---

# Relatório de negócio sob demanda

Dispara a edge function `business-metrics-report` (a mesma do cron diário das 9h BRT) e resume o resultado aqui no chat. O e-mail chega em tessuportegeral@gmail.com como sempre.

## Como disparar

POST em `https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/business-metrics-report` com header `x-cron-secret: dp_biz_metrics_w9k3r7` (verify_jwt é false; o secret tá no código da função no repo).

Body por tipo:
- **Diário (ontem)** — o padrão: body `{}`
- **Semanal (últimos 7 dias)**: `{"force_period":"weekly"}`
- **Mês fechado**: `{"force_period":"monthly"}` (mês anterior) ou `{"force_period":"monthly","month":7,"year":2026}` pra mirar um mês específico
- O mensal inclui os extras: funil de lealdade, pedidos de dorama e raio-X de segurança.

Usar curl com valores LITERAIS (path/token/URL sem variável — `$VAR` no comando reativa prompt de aprovação).

## Depois de disparar

1. Conferir que a resposta foi `{ok: true, ...}`.
2. Avisar o Stefano que o e-mail foi enviado e **resumir os números principais aqui no chat** (ele nem sempre abre o e-mail na hora): cadastros → pagaram (%), faturamento, vendas bot × site, ativos agora, retenção/churn vs período anterior.
3. Se algum número parecer estranho (ex.: zerado, muito fora da média), conferir a query direto no banco antes de repassar — o relatório já teve bug de subcontagem (cap de 1000 linhas, NULL em FILTER) e falha silenciosa de e-mail.

## Contexto dos números (pra interpretar certo)

- "Desses, pagaram" = conta criada no período que tem QUALQUER linha em subscriptions (pode ter pago depois do período — número de dia recente ainda sobe).
- Renovação atrasada é normal no PIX (~90% renova com atraso, média ~11 dias) — churn de verdade é o número "congelado" do relatório, não o atraso.
- Venda avulsa (R$10, plan='series') fica FORA do faturamento de assinatura, de propósito.
- Mesmos números do painel /admin/analytics (mesma conta, nunca divergem de propósito).
