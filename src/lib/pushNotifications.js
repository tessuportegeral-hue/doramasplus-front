import { supabase } from '@/lib/customSupabaseClient';

// Chave pública VAPID — segura pra expor no frontend (é a metade "pública"
// do par de chaves; a privada só existe nos secrets da edge function).
const VAPID_PUBLIC_KEY =
  'BEU1mcl84vTM-8vmjVTXCdjqeGtvRwEy6ORtOj913ApUPDw-6l_ZFi6N1cNeM5mpFiKTH6_Ndox0emFskArTcVY';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function getNotificationPermission() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

async function registerServiceWorker() {
  return navigator.serviceWorker.register('/sw.js');
}

export async function subscribeToPush(userId) {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (!userId) return { ok: false, reason: 'not_authenticated' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const registration = await registerServiceWorker();
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: 'endpoint' }
    );

    if (error) {
      console.error('[push] falha ao salvar subscription:', error);
      return { ok: false, reason: 'db_error', detail: error.message || JSON.stringify(error) };
    }

    return { ok: true };
  } catch (e) {
    console.error('[push] falha ao assinar:', e);
    return { ok: false, reason: 'subscribe_error', detail: `${e?.name || ''}: ${e?.message || String(e)}` };
  }
}
