// Módulo compartilhado pra liberar assinatura com segurança.
// Importado por: clever-worker, infinitepay-reconcile,
// infinitepay-verify-payment, whatsapp-sales-bot, asaas-webhook.
//
// Por que existe: até 19/07/2026, cada uma dessas funções tinha sua
// própria cópia da lógica de "grava subscriptions, depois atualiza
// profiles". Duas delas (infinitepay-reconcile e whatsapp-sales-bot)
// atualizavam profiles mesmo quando a gravação em subscriptions falhava
// — como o gate de acesso real (SupabaseAuthContext.jsx) só consulta
// subscriptions, isso criava "acesso fantasma" (profiles dizendo
// assinante, sem nada em subscriptions). Achado em 18 contas reais num
// mês. Esse módulo garante que profiles só é tocado se subscriptions
// realmente gravou — editar aqui corrige/protege todas as funções de
// uma vez, em vez de cada uma ter que lembrar de replicar o gate.
//
// stripe-webhook NÃO usa esse módulo: tem um formato de linha bem
// diferente (upsertSubscriptionFromStripe) e não escreve em
// profiles.subscription_active_until hoje — fora do escopo desse bug.

export type GrantResult = { ok: true } | { ok: false; error: unknown };

export async function grantSubscriptionAndProfile(
  supabase: any,
  userId: string,
  // Tudo que vai na linha de subscriptions, EXCETO user_id (que é sempre
  // o parâmetro acima — evita passar o id errado por engano).
  subscriptionFields: Record<string, unknown>,
): Promise<GrantResult> {
  try {
    const { error: subErr } = await supabase
      .from("subscriptions")
      .upsert({ user_id: userId, ...subscriptionFields }, { onConflict: "user_id" });

    if (subErr) {
      console.error("[grant-subscription] upsert em subscriptions falhou, NAO atualizando profiles:", subErr);
      return { ok: false, error: subErr };
    }
  } catch (e) {
    console.error("[grant-subscription] excecao no upsert de subscriptions:", e);
    return { ok: false, error: e };
  }

  // subscriptions gravou com sucesso — agora sim pode mexer em profiles.
  try {
    const endAt =
      (subscriptionFields.end_at as string | undefined) ??
      (subscriptionFields.current_period_end as string | undefined) ??
      null;

    await supabase
      .from("profiles")
      .update({
        active: true,
        subscription_active_until: endAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
  } catch (e) {
    // Não falha a liberação por causa disso: subscriptions (a fonte de
    // verdade do gate) já está correta. profiles é só cache/exibição.
    console.error("[grant-subscription] profiles update falhou (nao critico, subscriptions ja gravou):", e);
  }

  return { ok: true };
}
