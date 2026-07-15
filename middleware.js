// Vercel Edge Middleware — só roda pra /dorama/:slug (ver config.matcher).
//
// Por que existe: o site é uma SPA client-side (Vite + React Router), e o
// vercel.json tem um rewrite catch-all ("/(.*)" -> "/") — isso significa que
// TODO caminho, incluindo um slug de dorama que não existe, recebe HTTP 200
// com o index.html antes de qualquer JS rodar. O React só descobre "não
// achei esse dorama" depois, client-side (soft 404 — ruim pra SEO/Search
// Console). Esse middleware intercepta antes do rewrite e resolve 3 casos:
//
// 1. Slug existe em `doramas`            -> deixa passar normal (200 real).
// 2. Slug existe em `slug_redirects`      -> 301 pro slug novo.
// 3. Não existe em nenhuma das duas       -> serve o mesmo HTML da SPA
//    (React ainda mostra a tela "Dorama não encontrado"), mas com status
//    HTTP 404 de verdade, pra crawler não indexar como página válida.
//
// Se a checagem no Supabase falhar por qualquer motivo (timeout, etc.),
// deixa passar normal — nunca bloqueia um usuário real por causa de uma
// instabilidade momentânea na checagem.

const SUPABASE_URL = "https://fbngdxhkaueaolnyswgn.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM";

function passThrough() {
  // Protocolo cru do Vercel Edge Middleware pra "continua o processamento
  // normal" (equivalente ao helper next() de @vercel/edge, sem precisar
  // adicionar essa dependência só por isso).
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

async function supabaseSelect(table, column, value, selectCols) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${selectCols}&${column}=eq.${encodeURIComponent(value)}&limit=1`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) throw new Error(`supabase ${table} query failed: ${res.status}`);
  return res.json();
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/dorama\/([^/]+)\/?$/);
  if (!match) return passThrough();

  const slug = decodeURIComponent(match[1]).trim().toLowerCase();
  if (!slug) return passThrough();

  try {
    const doramaRows = await supabaseSelect("doramas", "slug", slug, "id");
    if (doramaRows.length > 0) return passThrough();

    const redirectRows = await supabaseSelect("slug_redirects", "old_slug", slug, "new_slug");
    const newSlug = redirectRows[0]?.new_slug;
    if (newSlug) {
      return Response.redirect(new URL(`/dorama/${newSlug}`, url), 301);
    }

    const shellRes = await fetch(new URL("/", url));
    const body = await shellRes.text();
    return new Response(body, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    console.error("[middleware] slug check failed, passando direto:", String(e));
    return passThrough();
  }
}

export const config = {
  matcher: ["/dorama/:slug"],
};
