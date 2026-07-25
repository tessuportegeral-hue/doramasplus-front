// ✅ 25/07: carrega o histórico de conversa da Dora (últimos 30 dias) pra
// quem está logado — sem isso, toda vez que a pessoa reabria o site/app a
// conversa começava do zero, mesmo tendo falado com a Dora recentemente.
// Segue o mesmo padrão de dora-recovery-check (JWT do chamador validado,
// depois service role pra ler a tabela — RLS de dora_conversations não
// libera SELECT direto pro cliente).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ messages: [] }, 200);

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ messages: [] }, 200);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin
      .from("dora_conversations")
      .select("role, content, created_at")
      .eq("user_id", userData.user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) return json({ error: String(error.message || error) }, 500);

    return json({ messages: data ?? [] }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
