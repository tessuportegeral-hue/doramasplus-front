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
// O token é o link de pagamento real, codificado em base64url — sem
// depender de tabela nenhuma. Só redireciona se o destino decodificado for
// de um domínio confiável (evita virar open redirect).

const ALLOWED_HOST_SUFFIXES = ["infinitepay.io"];

function base64UrlDecode(input: string): string | null {
  try {
    let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return atob(b64);
  } catch {
    return null;
  }
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const decoded = token ? base64UrlDecode(token) : null;

  if (!decoded) {
    return new Response("Link inválido ou expirado.", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(decoded);
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
