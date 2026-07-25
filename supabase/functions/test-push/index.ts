// Function de teste (25/07) pra validar o envio de Web Push ponta a ponta
// antes de ligar os gatilhos reais (renovação, dorama novo, admin, Dora).
// Uso: POST com { email } — manda uma notificação de teste pra todas as
// subscriptions daquele usuário.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUser } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CHECK_SECRET = "dp_test_push_x9k2m4";

Deno.serve(async (req) => {
  if (req.headers.get("x-check-secret") !== CHECK_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email) return new Response(JSON.stringify({ error: "missing_email" }), { status: 400 });

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (error || !profile?.id) {
      return new Response(JSON.stringify({ error: "user_not_found" }), { status: 404 });
    }

    const result = await sendPushToUser(supabase, profile.id, {
      title: "DoramasPlus 💜",
      body: "Teste de notificação — se você tá vendo isso, funcionou! 🎉",
      url: "/",
    });

    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
