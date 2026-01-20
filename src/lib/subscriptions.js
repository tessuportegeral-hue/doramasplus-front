import { supabase } from './supabaseClient';

export async function getActiveSubscription(userId) {
  if (!userId) return null;

  try {
    const now = new Date().toISOString();
    
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .gte("current_period_end", now)
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Erro ao buscar assinatura ativa:", error);
      return null;
    }

    return data; // returns null if no active subscription found
  } catch (err) {
    console.error("Erro na verificação de assinatura:", err);
    return null;
  }
}

export async function hasActiveSubscription(userId) {
  const sub = await getActiveSubscription(userId);
  return !!sub;
}