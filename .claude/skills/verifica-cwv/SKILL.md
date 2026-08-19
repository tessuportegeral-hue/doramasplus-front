---
name: verifica-cwv
description: Ler o Core Web Vitals real-user (RUM) por carimbo de deploy e apontar o próximo vilão com dados — usar quando o Stefano pedir "verifica o core web vitals" ou "verifica"
---

# Verificação de Core Web Vitals (RUM próprio)

Lê a telemetria real-user da tabela `web_vitals_events` (Supabase), sempre **por carimbo de deploy** (`app_version` = 8 primeiros chars do commit, injetado no build pela Vercel). Metas Google: CLS ≤ 0,10 · LCP ≤ 2500ms · INP ≤ 200ms (p75, mobile).

## Regras

1. **NUNCA usar GSC/CrUX como termômetro de fix** — janela de 28 dias, número fica feio por semanas mesmo com fix certo. O RUM reporta em horas.
2. **Sempre comparar carimbo atual vs anterior** — é o que prova se a última dose funcionou. Descobrir o carimbo atual: `git log --format=%h -1` (encurtar pra 8 chars) e conferir se já tem amostra; se o deploy é recente demais (<2h), avisar que a amostra é pequena.
3. **Antes de propor dose nova: ler a memória** `project-web-vitals-rum-instrumentation` — tem a lista de TESES TESTADAS E MORTAS. Nunca repetir tese morta.
4. Mobile é o que importa (`is_mobile = true`).
5. Dose aplicada = commit com prefixo `perf(inp):`/`fix(cls):` etc + push + atualizar a memória com o round e o que olhar no próximo verifica.

## Query principal (placar por carimbo × página)

```sql
select app_version, metric,
  case when page_path in ('/','/dashboard') then 'home'
       when page_path like '/dorama/%' and page_path not like '%/watch%' then 'detalhe'
       when page_path like '%/watch%' then 'watch' else 'outros' end as pg,
  count(*) as n,
  round(percentile_cont(0.75) within group (order by value)::numeric, 3) as p75,
  round(100.0*sum(case when rating='good' then 1 else 0 end)/count(*),0) as pct_good
from web_vitals_events
where is_mobile and created_at > now() - interval '2 days'
  and metric in ('CLS','LCP','INP')
group by 1,2,3 having count(*) >= 15
order by 1 desc, 3, 2;
```
(Rodar via `mcp__supabase__execute_sql`, envolver em `select json_agg(t) from (...) t`.)

## Drill-down do INP (achar o vilão)

```sql
select attribution_target,
  attribution_detail->>'interactionType' as itype,
  count(*) n,
  round(percentile_cont(0.75) within group (order by value)::numeric) p75,
  round(percentile_cont(0.75) within group (order by (attribution_detail->>'inputDelay')::numeric)::numeric) in_delay,
  round(percentile_cont(0.75) within group (order by (attribution_detail->>'processingDuration')::numeric)::numeric) proc,
  round(percentile_cont(0.75) within group (order by (attribution_detail->>'presentationDelay')::numeric)::numeric) present
from web_vitals_events
where metric='INP' and is_mobile and app_version='<CARIMBO>' and page_path in ('/','/dashboard')
group by 1,2 order by n desc limit 15;
```
Como ler: `inputDelay` alto = main thread ocupada quando a interação chegou (commit grande de render — ver `attribution_detail->'loafs'` pros scripts); `processing` alto = handler pesado; `presentationDelay` alto = o frame depois do handler tá caro (montagem/desmontagem grande no mesmo frame). `attribution_target` null em pointer = o elemento já desmontou (típico de navegação). Pra CLS o campo é `attribution_target` (elemento que pulou) + `largestShiftValue`.

## Formato do relatório pro Stefano

- Tabela: página × CLS/LCP/INP com ✅/⚠️/❌ e nº de amostras.
- Veredito da última dose: funcionou/não funcionou NO ALVO dela (comparar a métrica específica, não só o total).
- Vilão atual nº 1 com os números da attribution.
- Dose candidata (1 parágrafo). Se o diagnóstico tá fechado e o fix é reversível, aplicar direto (regra do Stefano 13/08: "fix com dado = aplica, sem pedir") — EXCETO se ele tiver mandado parar.
- Sempre terminar dizendo se algum slug mudou (nunca deve).
