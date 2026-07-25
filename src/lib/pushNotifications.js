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

// ✅ 25/07: checagem barata (só um SELECT) pra saber se já existe uma
// assinatura válida e salva — sem isso, a sincronização silenciosa (que
// roda a cada evento de auth) chamava subscribeToPush toda vez, e como
// subscribeToPush sempre descarta e recria (ver comentário abaixo), cada
// evento de auth gerava uma linha nova no banco. Em rajadas de eventos
// (múltiplas abas, refresh de token, etc.) isso lotou a tabela de lixo.
export async function hasValidSubscription(userId) {
  if (!isPushSupported() || !userId) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) return false;
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return false;

    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('endpoint', existing.endpoint)
      .maybeSingle();

    return !error && !!data;
  } catch {
    return false;
  }
}

export async function subscribeToPush(userId) {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (!userId) return { ok: false, reason: 'not_authenticated' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const registration = await registerServiceWorker();
    await navigator.serviceWorker.ready;

    // ✅ 25/07: nunca reaproveita uma subscription existente — depois de
    // desinstalar/reinstalar o app, o Chrome às vezes mantém uma
    // subscription "fantasma" (o FCM aceita o envio mas nunca entrega,
    // sem devolver 404/410 pra gente saber). Descartar e pedir uma nova
    // sempre garante um endpoint de verdade.
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

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

// ✅ 25/07: trava contra corrida — o Supabase costuma disparar mais de um
// evento de auth em sequência rápida no carregamento (ex: INITIAL_SESSION
// + SIGNED_IN quase juntos). Sem isso, duas chamadas simultâneas de
// sincronização silenciosa passavam pela checagem "já existe?" ANTES de
// qualquer uma terminar de gravar, e as duas acabavam criando uma
// assinatura nova cada uma. Guardando a Promise em andamento, a segunda
// chamada só espera a primeira terminar em vez de duplicar o trabalho.
let syncInFlight = null;

export async function ensureSubscriptionSynced(userId) {
  if (!isPushSupported() || !userId) return;
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      const already = await hasValidSubscription(userId);
      if (already) return;
      const result = await subscribeToPush(userId);
      if (!result.ok) console.error('[push] sync silenciosa falhou:', result.reason, result.detail);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}
