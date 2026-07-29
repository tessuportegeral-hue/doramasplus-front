import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "env_missing" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "no_auth" }, 401);

    const body = await req.json().catch(() => ({} as any));
    const deviceId = String(body?.device_id || "").trim();
    const deviceName = String(body?.device_name || "").trim().slice(0, 100);
    const force = body?.force === true;

    if (!deviceId) return json({ error: "device_id_required" }, 400);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "";
    const userAgent = (req.headers.get("user-agent") || "").slice(0, 500);

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthenticated" }, 401);

    const userId = userData.user.id;

    // ✅ 29/07 — afiando SÓ pra tesagencia por enquanto (pedido explícito):
    // heartbeat mais curto e limpeza de sessão zumbi mais rápida. Todo
    // mundo continua no valor de produção (6s / 25s) até validar.
    const SHARP_TEST_EMAIL = "tesagencia@gmail.com";
    const isSharpTestUser = userData.user.email === SHARP_TEST_EMAIL;
    const staleAfterMs = isSharpTestUser ? 9_000 : 25_000;
    const heartbeatSeconds = isSharpTestUser ? 3 : 6;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: subRows } = await admin
      .from("subscriptions")
      .select("max_concurrent_streams")
      .eq("user_id", userId)
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(1);

    const maxStreams = subRows?.[0]?.max_concurrent_streams ?? 1;

    // Expirar sessoes zumbi sem heartbeat recente
    await admin
      .from("playback_sessions")
      .delete()
      .eq("user_id", userId)
      .lt("last_heartbeat", new Date(Date.now() - staleAfterMs).toISOString());

    const { data: existing } = await admin
      .from("playback_sessions")
      .select("id, device_id, device_name, last_heartbeat")
      .eq("user_id", userId);

    const myExisting = existing?.find((s: any) => s.device_id === deviceId);
    const others = (existing || []).filter((s: any) => s.device_id !== deviceId);

    if (!myExisting && others.length >= maxStreams && !force) {
      await admin.from("playback_switch_log").insert({
        user_id: userId,
        switched_at: new Date().toISOString(),
        event_type: "blocked",
        device_id: deviceId,
        device_name: deviceName || null,
        previous_device_id: others[0]?.device_id || null,
        previous_device_name: others[0]?.device_name || null,
        ip: ip || null,
      });

      return json({ allowed: false, reason: "limit_reached", max_streams: maxStreams, active_count: others.length, message: "Outro dispositivo está assistindo agora." }, 409);
    }

    if (force && others.length > 0) {
      const toKick = others.slice(0, Math.max(0, others.length - maxStreams + 1));
      if (toKick.length > 0) {
        await admin.from("playback_sessions").delete().in("id", toKick.map((s: any) => s.id));
        await admin.from("playback_switch_log").insert({
          user_id: userId,
          switched_at: new Date().toISOString(),
          event_type: "forced_entry",
          device_id: deviceId,
          device_name: deviceName || null,
          previous_device_id: toKick[0]?.device_id || null,
          previous_device_name: toKick[0]?.device_name || null,
          ip: ip || null,
        });
      }
    }

    const now = new Date().toISOString();

    await admin.from("playback_sessions").upsert({
      user_id: userId,
      device_id: deviceId,
      device_name: deviceName || null,
      ip: ip || null,
      user_agent: userAgent || null,
      last_heartbeat: now,
      started_at: now,
    }, { onConflict: "user_id,device_id" });

    return json({ allowed: true, max_streams: maxStreams, heartbeat_interval_seconds: heartbeatSeconds });
  } catch (e) {
    return json({ error: "internal", details: String(e) }, 500);
  }
});
