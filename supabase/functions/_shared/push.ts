// Módulo compartilhado de envio de Web Push.
// Importado por: test-push, e futuramente pelos gatilhos de renovação,
// dorama novo, disparo manual do admin e resposta da Dora.
//
// Precisa dos secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT
// configurados no projeto (Supabase Dashboard > Edge Functions > Secrets) —
// não dá pra setar isso via MCP, só pelo painel ou CLI.

import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:tessuportegeral@gmail.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export type PushPayload = { title: string; body: string; url?: string };

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

// Manda pra uma subscription específica. Se o navegador confirmar que o
// endpoint não existe mais (404/410 — desinstalou o app, revogou a
// permissão, etc.), apaga a linha pra não ficar tentando de novo pra sempre.
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
      JSON.stringify(payload)
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
