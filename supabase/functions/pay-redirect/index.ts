// pay-redirect: recebe /r/<token> (via rewrite no vercel.json) e redireciona
// de verdade pro link de pagamento real (hoje só InfinityPay).
//
// Por quê existe: o botão de link nos templates de WhatsApp aprovados pela
// Meta só aceita variável de URL dentro do MESMO domínio que foi aprovado
// (doramasplus.com.br). Não dá pra apontar direto pro checkout da
// InfinityPay (domínio diferente) sem arriscar quebrar o botão. Esse
// redirect mantém o link sempre em doramasplus.com.br e só troca de
// domínio depois que a pessoa já clicou.
//
// O token é um código curto gravado em payment_redirects na hora que o
// link é gerado (whatsapp-renewal-cron) — evita link gigante (a URL da
// InfinityPay já vem longa por natureza) e só resolve o destino real
// quando alguém clica.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED_HOST_SUFFIXES = ["infinitepay.io", "asaas.com"];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return new Response("Link inválido ou expirado.", { status: 400 });
  }

  const { data, error } = await supabase
    .from("payment_redirects")
    .select("target_url")
    .eq("token", token)
    .maybeSingle();

  if (error || !data?.target_url) {
    return new Response("Link inválido ou expirado.", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(data.target_url);
  } catch {
    return new Response("Link inválido ou expirado.", { status: 400 });
  }

  const hostOk =
    target.protocol === "https:" &&
    ALLOWED_HOST_SUFFIXES.some(
      (suf) => target.hostname === suf || target.hostname.endsWith("." + suf)
    );

  if (!hostOk) {
    return new Response("Destino não permitido.", { status: 400 });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: target.toString() },
  });
});
