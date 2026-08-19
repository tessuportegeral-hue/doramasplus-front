---
name: ativa
description: Ativação/extensão manual de assinatura de um cliente via SQL (pagou por fora, cortesia, correção) — com o checklist que evita os erros já cometidos (referral não creditado, profiles.active dessincronizado)
---

# Ativação manual de assinatura

Usar quando o Stefano pedir pra ativar/estender a assinatura de alguém na mão (pagamento por fora, cortesia, correção de erro).

## Checklist (ordem obrigatória)

1. **Achar o user_id** (email/telefone — telefone: casar formato com e sem prefixo 55).
2. **Ver o estado atual** (`subscriptions` do user) antes de mexer — pode já existir linha; é UPDATE, não INSERT duplicado. Mesmo user com 2+ linhas ativas = bug, avisar.
3. **Ativar**: upsert em `subscriptions` com:
   - `status = 'active'`
   - `end_at = <data combinada>` — **OBRIGATÓRIO ter data**: não-Stripe com `end_at null` = acesso NEGADO pelo gate (só Stripe legado com provider null vive sem data).
   - plan_name/plan_interval coerentes (mensal/trimestral).
4. **Registrar o histórico**: insert em `subscription_renewals` com `source = 'admin_manual'`, `start_at`/`end_at` preenchidos (é daí que o relatório estima o valor: dias ÷ 30 × preço mensal) e `is_renewal` correto (false se é a primeira vez do usuário).
5. **Conferir `profiles.active`** — o trigger `trg_sync_profile_active` deveria sincronizar sozinho; conferir que virou true. Se não virou, o trigger quebrou (avisar).
6. **CHECAR INDICAÇÃO (o erro clássico)**: se `profiles.referred_by` tá preenchido e é a primeira assinatura paga do usuário, creditar o indicador via edge function `admin-credit-referral` — NUNCA pular. Ativação manual sem crédito já aconteceu e gerou reclamação.
7. **Verificar o resultado**: rodar a query do gate e confirmar que o acesso tá liberado:
```sql
select s.status, s.provider, coalesce(s.end_at, s.current_period_end) as fim,
  (s.status in ('active','trialing','paid') and (
    (coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
    or coalesce(s.end_at, s.current_period_end) > now())) as tem_acesso
from subscriptions s where s.user_id = '<id>';
```
8. Responder pro Stefano: quem, até quando, valor estimado registrado, indicação creditada (ou "não tinha indicação").

## Regras

- `exec_sql` (RPC) não roda DML — usar `mcp__supabase__execute_sql` direto.
- Só 1 usuário por vez. Ativação em MASSA = dry-run com a lista antes (regra da skill /integridade).
- Preços vigentes: mensal R$17,90 · trimestral R$49,90 (Passe Teste trial3 R$2,99/1 dia é só InfinityPay, fluxo próprio).
- Nunca mexer nas edge functions de pagamento pra "facilitar" ativação — regra do CLAUDE.md.
