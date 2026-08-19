---
name: integridade
description: Auditoria de integridade de assinaturas e pagamentos (pix sem sub, acesso fantasma, referral não creditado, dessincronia) — usar quando o Stefano pedir "verifica as assinaturas", "roda a integridade" ou quando o tema surgir
---

# Auditoria de integridade de assinaturas

Roda as checagens que já pegaram problema real em produção. **Só REPORTA** — correção pontual (1 usuário) pode aplicar se o diagnóstico fechar; correção em massa segue a regra de dry-run abaixo.

## Regras de ouro

1. **NUNCA UPDATE/DELETE em massa sem dry-run.** Primeiro o SELECT com a lista exata de quem seria afetado, mostrar pro Stefano, só executar depois do ok. Scripts antigos já cortaram 47 pagantes REAIS por engano.
2. **`NOT IN` com coluna que tem NULL zera o resultado** (`pix_payments.user_id` tem NULL) — usar `NOT EXISTS`.
3. **`subscriptions.provider = null` é Stripe** (legado). `end_at null + provider null` = acesso válido (Stripe sem data). `end_at null + provider preenchido` = NEGADO pelo gate.
4. **Stripe "orphaned" pode ser falso positivo** (webhook de cancelamento perdido) — SEMPRE cruzar com `pix_payments` e com o Stripe real antes de cortar acesso de alguém.
5. Ativação manual via SQL: checar `referred_by` do usuário e creditar via `admin-credit-referral` (nunca esquecer o crédito da indicação).
6. `exec_sql` não roda DML — DML via `mcp__supabase__execute_sql` direto.

## Checagens (rodar todas, reportar em tabela)

1. **PIX pago sem assinatura ativa** (últimos 30d):
```sql
select p.id, p.user_id, p.amount_cents, p.plan, p.created_at
from pix_payments p
where p.status = 'paid' and p.created_at > now() - interval '30 days'
  and p.user_id is not null
  and not exists (
    select 1 from subscriptions s where s.user_id = p.user_id
      and s.status in ('active','trialing','paid')
      and (coalesce(s.end_at, s.current_period_end) > now()
           or (coalesce(s.end_at, s.current_period_end) is null and s.provider is null)))
order by p.created_at desc;
```
2. **Acesso fantasma** (profiles.active = true sem subscription válida) e o inverso — o trigger `trg_sync_profile_active` deveria manter em dia; divergência = trigger quebrou.
3. **end_at nulo com provider preenchido** (acesso negado indevido ou lixo de dado).
4. **Referral não creditado**: indicações `pending` presas com indicado que já pagou; e crédito PIX que não refletiu no `end_at` (bug conhecido — memória `project-referral-pix-credit-not-reflected`).
5. **Contas zumbi de delete-account** (auth.users sem profile ou vice-versa).
6. **Duplicidade de assinatura ativa** (mesmo user_id com 2+ linhas ativas).
7. **pix_payments pending muito antigo** ainda contando no painel (só informativo).

## Relatório

- Tabela: checagem × quantos casos × exemplos (máx 5 ids/emails).
- Zero casos = dizer "limpo" explicitamente.
- Caso encontrado: propor a correção com o SQL do dry-run pronto, e lembrar qual memória documenta o padrão (ex.: `project-ghost-access-profiles-vs-subscriptions`, `feedback-manual-db-activation-check-referral`).
- Nunca mexer em lógica de pagamento (edge functions) sem autorização explícita — regra do CLAUDE.md.
