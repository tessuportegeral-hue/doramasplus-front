// ✅ 25/07: avisa por push quando o admin responde manualmente uma conversa
// escalada da Dora (painel /admin/dora) — antes disso, quem saía do app não
// tinha como saber que foi respondido, só voltando pra conferir por conta
// própria. Disparado por um trigger no Postgres (ver migration
// notify_dora_admin_reply_trigger), não direto pelo frontend — funciona
// não importa por onde a resposta seja inserida.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUser } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TRIGGER_SECRET = "dp_dora_reply_push_j3n8q2";

Deno.serve(async (req) => {
  if (req.headers.get("x-trigger-secret") !== TRIGGER_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id || "").trim();
    const content = String(body?.content || "").trim();

    if (!userId) return new Response(JSON.stringify({ error: "missing_user_id" }), { status: 400 });

    const preview = content.length > 100 ? `${content.slice(0, 100)}...` : content;

    const result = await sendPushToUser(supabase, userId, {
      title: "A Dora te respondeu! 🌸",
      body: preview || "Você tem uma nova resposta esperando.",
      url: "/",
    });

    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
