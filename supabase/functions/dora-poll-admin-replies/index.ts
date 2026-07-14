// dora-poll-admin-replies (Deno runtime)
// A Dora (widget flutuante) só grava/mostra mensagens no momento em que o
// visitante manda algo — não existe realtime nem canal de volta pro cliente.
// Essa function deixa o widget perguntar "chegou resposta nova do admin pra
// essa sessão desde X?" sem expor a tabela dora_conversations via RLS pra
// visitantes anônimos (ela só é legível pelo admin).
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return json({ error: "env ausente" }, 500);

    const body = await req.json().catch(() => ({} as any));
    const sessionId = String(body?.session_id ?? "").trim();
    const after = String(body?.after ?? "").trim();

    if (!sessionId) return json({ error: "session_id ausente" }, 400);

    const afterDate = new Date(after);
    const afterIso = Number.isNaN(afterDate.getTime())
      ? new Date(0).toISOString()
      : afterDate.toISOString();

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase
      .from("dora_conversations")
      .select("id, content, created_at")
      .eq("session_id", sessionId)
      .eq("role", "admin")
      .gt("created_at", afterIso)
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) return json({ error: String(error.message || error) }, 500);

    return json({ messages: data ?? [] }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
