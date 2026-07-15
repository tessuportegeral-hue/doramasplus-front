// dora-recovery-check: chamada pelo widget da Dora quando o usuário logado
// abre o site. Verifica se existe mensagem "role=admin" pendente de entrega
// pra essa conta (ex.: pedido de desculpas de um broadcast, já que o polling
// normal da Dora só funciona por session_id ao vivo — não existe canal pra
// entregar mensagem pra quem já saiu do site). Marca como entregue assim que
// devolve, pra não repetir na próxima visita.
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

    const { data, error } = await admin
      .from("dora_conversations")
      .select("id, content, created_at")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .is("delivered_at", null)
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) return json({ error: String(error.message || error) }, 500);

    const rows = data ?? [];
    if (rows.length > 0) {
      await admin
        .from("dora_conversations")
        .update({ delivered_at: new Date().toISOString() })
        .in("id", rows.map((r) => r.id));
    }

    return json({ messages: rows }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
