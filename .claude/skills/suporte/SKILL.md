---
name: suporte
description: Diagnóstico completo de um cliente por email ou telefone — perfil, assinatura, pagamentos, dispositivos assistindo, indicação — com as regras de negócio conhecidas já aplicadas
---

# Diagnóstico de cliente (suporte)

Entrada: email ou telefone do cliente. Saída: raio-X completo + veredito ("tem acesso? por quê? qual o problema provável?").

## Como achar o usuário

- Por email: `profiles` (ou `auth.users` se não achar — conta zumbi de delete-account é um caso conhecido).
- Por telefone: **`profiles.phone` NÃO tem prefixo 55; o salesbot usa COM 55** — sempre casar os dois formatos:
  `where phone = '<com55>' or phone = '<sem55>'`
- Venda avulsa (R$10) não tem user_id — telefone fica em `pix_payments.order_nsu`: `split_part(order_nsu,'|',2)`.

## O que puxar (uma query por bloco, via mcp__supabase__execute_sql)

1. **Perfil**: id, email, phone, active, created_at, referred_by, stripe_customer_id.
2. **Assinatura** (`subscriptions`): status, provider, plan_name, plan_interval, start_at, end_at, current_period_end.
3. **Pagamentos**: últimos 10 de `pix_payments` (status, amount_cents, plan, provider, source, created_at) + `subscription_renewals` (histórico, nunca é sobrescrito — a `subscriptions` É sobrescrita a cada pagamento).
4. **Assistindo agora**: `playback_sessions` do user (device, last_heartbeat) + `subscriptions.max_concurrent_streams` (hoje 1 pra todos). `playback_switch_log` se houver briga de dispositivo.
5. **Indicação**: `referred_by` preenchido? crédito foi dado? (bug conhecido: crédito PIX às vezes não reflete no end_at).

## Regras de negócio pra dar o veredito

- **Gate de acesso (mesma regra do site)**: `status in ('active','trialing','paid')` E (`end_at/current_period_end > now()` OU (`end_at null` E `provider null`)).
- **`provider = null` é Stripe** (legado). `end_at null` + provider preenchido = **NEGADO** (dado quebrado, não feature).
- **Cancelou no Stripe = mantém acesso até o fim do período pago** (comportamento correto desde 06/08).
- **"Não consigo assistir" com assinatura válida** = quase sempre rede/DNS/VPN do cliente — orientar VPN ou DNS 1.1.1.1, **não mexer no código**.
- **"Limite de Reprodução"** = outro dispositivo com stream ativo (limite 1). Orientação oficial: fazer login de novo (`/login`) — o botão do player já manda pra lá. Sessão zumbi expira em 9s sozinha.
- Dois navegadores na mesma máquina = 2 dispositivos (device id em `localStorage.dp_device_id`).
- **Contestação/disputa Stripe**: corrigir no banco E no Stripe real (trial_end) — nunca só no banco.
- Renovação atrasada é NORMAL no PIX (90% renova atrasado, média ~11 dias) — não é churn ainda.

## Formato da resposta

1. Veredito em 1 linha: "TEM acesso até DD/MM (plano X via Y)" ou "SEM acesso desde DD/MM porque Z".
2. Tabela curta: perfil / assinatura / último pagamento / dispositivos agora.
3. Problema provável + o que orientar o cliente (linguagem simples, pro Stefano copiar e colar se quiser).
4. Se precisar de correção no banco: propor o SQL, aplicar só correção PONTUAL (1 usuário) — e se envolver ativação, seguir a skill **/ativa** (crédito de indicação!).
