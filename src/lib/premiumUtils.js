import { supabase } from './supabaseClient';

export const getIsPremiumUser = async (userId) => {
  if (!userId) return false;

  try {
    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('status, end_at, current_period_end')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing']);
    
    if (error) {
      console.error("Error fetching user subscription:", error.message);
      return false;
    }

    if (!subscriptions || subscriptions.length === 0) {
      return false;
    }

    const now = new Date();
    // Check if any subscription is currently active
    const hasActiveSubscription = subscriptions.some(sub => {
      const endDate = sub.end_at || sub.current_period_end;
      return endDate && new Date(endDate) > now;
    });
    
    return hasActiveSubscription;

  } catch (err) {
    console.error("Unexpected error in getIsPremiumUser:", err);
    return false;
  }
};