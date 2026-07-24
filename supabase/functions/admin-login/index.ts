import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!email || !password) {
      return json(400, { ok: false, error: "missing_fields" });
    }

    // Comparação sempre roda (mesmo sem achar o email) pra não vazar via
    // timing se o email existe ou não na tabela.
    const { data: row } = await supabase
      .from("admin_users")
      .select("senha_hash")
      .eq("email", email)
      .maybeSingle();

    const hashToCheck = row?.senha_hash || "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
    const match = await bcrypt.compare(password, hashToCheck);

    if (!row || !match) {
      return json(200, { ok: false, error: "invalid_credentials" });
    }

    // ✅ 25/07: a senha do admin_users só provava a identidade pro
    // localStorage — nunca criava sessão real do Supabase Auth. Como as
    // RLS de painéis como dora_conversations exigem auth.uid()/auth.email()
    // de verdade, sem isso o painel carregava vazio pra quem só passasse
    // por essa tela (sem também estar logado no site com a mesma conta).
    // Gera um magic link e devolve o hashed_token pro front trocar por uma
    // sessão real via supabase.auth.verifyOtp — sem precisar clicar em email.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("[admin-login] generateLink falhou:", linkError);
      return json(200, { ok: true, token_hash: null });
    }

    return json(200, { ok: true, token_hash: linkData.properties.hashed_token });
  } catch (e) {
    console.error("[admin-login] fatal:", e);
    return json(500, { ok: false, error: "fatal" });
  }
});
