// ✅ 25/07: disparo manual de push pro admin — mesmo padrão de autenticação
// já usado em admin-analytics (JWT do chamador validado contra ADMIN_ID,
// depois service role pra fazer o trabalho pesado).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToAll } from "../_shared/push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ADMIN_ID = "094e70c6-0671-4401-89fe-31aa5242348a";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "no_auth" }, 401);

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthenticated" }, 401);
    if (userData.user.id !== ADMIN_ID) return json({ error: "forbidden" }, 403);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const body = await req.json().catch(() => ({}));

    // ✅ modo "stats": só devolve quantos assinantes existem hoje + histórico
    // de envios passados, sem mandar nada — pro admin ver antes de disparar.
    if (body?.action === "stats") {
      const { count: totalSubscribers } = await admin
        .from("push_subscriptions")
        .select("user_id", { count: "exact", head: true });

      const { data: history } = await admin
        .from("push_send_log")
        .select("id, title, body, sent, total, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      return json({ ok: true, total_subscribers: totalSubscribers || 0, history: history || [] });
    }

    const title = String(body?.title || "").trim();
    const message = String(body?.body || "").trim();
    const url = String(body?.url || "/").trim() || "/";

    if (!title || !message) return json({ error: "missing_title_or_body" }, 400);

    const result = await sendPushToAll(admin, { title, body: message, url });

    await admin.from("push_send_log").insert({
      title,
      body: message,
      url,
      sent: result.sent,
      total: result.total,
    });

    return json({ ok: true, ...result });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
