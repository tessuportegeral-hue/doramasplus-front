// ✅ 25/07: registra clique em notificação push — chamado pelo service
// worker (sw.js) no evento notificationclick, quando o payload trouxe um
// log_id (hoje só os disparos manuais do admin/push têm esse rastro).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const logId = String(body?.log_id || "").trim();
    if (!logId) return new Response(JSON.stringify({ ok: false, error: "missing_log_id" }), { status: 400, headers: corsHeaders });

    await supabase.rpc("increment_push_send_log_clicked", { log_id: logId });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
