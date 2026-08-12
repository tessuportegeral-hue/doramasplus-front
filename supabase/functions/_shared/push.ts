// Módulo compartilhado de envio de Web Push.
// Importado por: test-push, whatsapp-renewal-cron, admin-send-push,
// push-new-doramas-digest, push-dora-admin-reply.
//
// Precisa dos secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT
// configurados no projeto (Supabase Dashboard > Edge Functions > Secrets) —
// não dá pra setar isso via MCP, só pelo painel ou CLI.
//
// ✅ 12/08 (bundle do push-new-doramas-digest): TTL subiu de 60s pra 4h.
// Com TTL 60, celular offline/em economia de bateria no minuto do disparo
// = push DESCARTADO pelo FCM e a pessoa nunca vê (explicava parte dos
// "não recebi"). 4h cobre o intervalo entre janelas do digest sem risco
// de empilhar dia inteiro. Obs: cada function bundla sua própria cópia
// deste arquivo — esta mudança só vale pro digest até redeployar as outras.

import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:tessuportegeral@gmail.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  image?: string;
  icon?: string;
  cta?: string;
  log_id?: string;
};

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendPushToSubscription(
  supabase: any,
  sub: PushSubscriptionRow,
  payload: PushPayload
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("[push] VAPID keys não configuradas nos secrets");
    return false;
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 14400, urgency: "high" }
    );
    return true;
  } catch (e) {
    const statusCode = (e as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    } else {
      console.error("[push] falha ao enviar:", statusCode, String(e));
    }
    return false;
  }
}

export async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: PushPayload
): Promise<{ sent: number; total: number }> {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  const rows: PushSubscriptionRow[] = subs || [];
  let sent = 0;
  for (const sub of rows) {
    if (await sendPushToSubscription(supabase, sub, payload)) sent++;
  }
  return { sent, total: rows.length };
}

export async function sendPushToAll(
  supabase: any,
  payload: PushPayload
): Promise<{ sent: number; total: number }> {
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth");

  const rows: PushSubscriptionRow[] = subs || [];
  let sent = 0;
  for (const sub of rows) {
    if (await sendPushToSubscription(supabase, sub, payload)) sent++;
  }
  return { sent, total: rows.length };
}
