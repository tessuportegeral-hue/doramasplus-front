// Vercel Edge Middleware — só roda pra /dorama/:slug (ver config.matcher).
//
// Por que existe: o site é uma SPA client-side (Vite + React Router), e o
// vercel.json tem um rewrite catch-all ("/(.*)" -> "/") — isso significa que
// TODO caminho, incluindo um slug de dorama que não existe, recebe HTTP 200
// com o index.html antes de qualquer JS rodar. O React só descobre "não
// achei esse dorama" depois, client-side (soft 404 — ruim pra SEO/Search
// Console). Esse middleware intercepta antes do rewrite e resolve, PARA
// BOTS/CRAWLERS (humano passa direto, sem custo de latência):
//
// 1. Slug existe em `doramas`        -> serve o shell ENRIQUECIDO com o
//    conteúdo do dorama (title/description/OG/canonical/JSON-LD + um bloco
//    de HTML real dentro do #root). ✅ 13/08 — antes deixava passar o shell
//    GENÉRICO: toda página de dorama tinha HTML idêntico pro Google, que só
//    via conteúdo se a renderização JS + fetch no Supabase desse certo. Era
//    a causa estrutural do soft 404 continuar crescendo (645→797 páginas)
//    MESMO com validação em curso: dorama novo entrava na lista no primeiro
//    rastreio. Dynamic rendering é prática aceita pelo Google (não é
//    cloaking: o conteúdo é o MESMO que o React renderiza pro usuário).
// 2. Slug existe em `slug_redirects`  -> 301 pro slug novo.
// 3. Não existe em nenhuma das duas   -> serve o shell da SPA com status
//    HTTP 404 de verdade, pra crawler não indexar como página válida.
//
// Se a checagem no Supabase falhar por qualquer motivo (timeout, etc.),
// deixa passar normal — nunca bloqueia ninguém por instabilidade momentânea.
//
// IMPORTANTE (perf, achado no relatório de Core Web Vitals de 20/07): a
// checagem no Supabase só roda quando o User-Agent é de bot/crawler
// conhecido; humano passa direto (a checagem síncrona atrasava o TTFB de
// todo visitante real em ~3s).

const SUPABASE_URL = "https://fbngdxhkaueaolnyswgn.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM";

// Crawlers relevantes pra SEO / preview de link (não cobre usuário real).
const BOT_UA_RE =
  /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|slackbot|discordbot|linkedinbot|pinterest|embedly|quora link preview|showyoubot|outbrain|w3c_validator|redditbot|applebot/i;

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

// Escapa texto vindo do banco antes de entrar no HTML/atributo.
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Monta o shell da SPA com o conteúdo do dorama injetado (pra bot).
function buildSeoShell(shellHtml, dorama, canonicalUrl) {
  const lang = (dorama.language || "").toLowerCase() === "dublado" ? "Dublado" : "Legendado";
  const year = dorama.release_year ? ` (${dorama.release_year})` : "";
  const pageTitle = esc(`${dorama.title}${year} — Assistir ${lang} Online | DoramasPlus`);
  const rawDesc = (dorama.description || "").trim() ||
    `Assista ${dorama.title} ${lang.toLowerCase()} online no DoramasPlus. Catálogo completo de doramas, sem anúncios, com novidades todo dia.`;
  const metaDesc = esc(rawDesc.length > 300 ? rawDesc.slice(0, 297) + "…" : rawDesc);
  const cover = esc(dorama.cover_url || "https://doramasplus.com.br/og-image.png");
  const canonical = esc(canonicalUrl);

  let html = shellHtml
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${pageTitle}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${metaDesc}$2`)
    .replace(/(<meta property="og:type" content=")[^"]*(")/, `$1video.tv_show$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${pageTitle}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${metaDesc}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${cover}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${pageTitle}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${metaDesc}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${cover}$2`);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    name: dorama.title,
    description: rawDesc,
    image: dorama.cover_url || undefined,
    inLanguage: "pt-BR",
    url: canonicalUrl,
  };
  const headExtra =
    `<link rel="canonical" href="${canonical}" />` +
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`;
  html = html.replace("</head>", `${headExtra}</head>`);

  // Conteúdo real dentro do #root: o React substitui tudo isso ao hidratar
  // (bots que executam JS veem a página completa; bots que NÃO executam já
  // têm título, capa, sinopse e links — nunca mais uma página "vazia").
  const genres = esc(dorama.genres || "");
  const rootContent =
    `<main style="max-width:720px;margin:0 auto;padding:24px;color:#fff;background:#0f172a;font-family:sans-serif">` +
    `<h1>${esc(dorama.title)}</h1>` +
    `<p><strong>${lang}</strong>${dorama.release_year ? ` · ${dorama.release_year}` : ""}${genres ? ` · ${genres}` : ""}</p>` +
    `<img src="${cover}" alt="${esc(dorama.title)}" width="300" height="450" style="max-width:100%;height:auto;border-radius:12px" />` +
    `<p>${esc(rawDesc)}</p>` +
    `<p><a href="${canonical}/watch" style="color:#a78bfa">Assistir ${esc(dorama.title)} agora</a></p>` +
    `<p><a href="https://doramasplus.com.br/" style="color:#a78bfa">Ver o catálogo completo de doramas</a></p>` +
    `</main>`;
  html = html.replace('<div id="root"></div>', `<div id="root">${rootContent}</div>`);

  return html;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/dorama\/([^/]+)\/?$/);
  if (!match) return passThrough();

  const slug = decodeURIComponent(match[1]).trim().toLowerCase();
  if (!slug) return passThrough();

  const ua = request.headers.get("user-agent") || "";
  if (!BOT_UA_RE.test(ua)) return passThrough();

  try {
    const doramaRows = await supabaseSelect(
      "doramas",
      "slug",
      slug,
      "title,slug,description,release_year,genres,cover_url,language"
    );
    if (doramaRows.length > 0) {
      // ✅ 13/08 — bot em slug VÁLIDO recebe o shell enriquecido (era o
      // shell genérico idêntico em todas as páginas = soft 404 estrutural).
      const shellRes = await fetch(new URL("/", url));
      const shellHtml = await shellRes.text();
      const canonicalUrl = `https://doramasplus.com.br/dorama/${doramaRows[0].slug}`;
      return new Response(buildSeoShell(shellHtml, doramaRows[0], canonicalUrl), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          // cache curto na edge: alivia o Supabase em rajadas de crawl sem
          // servir conteúdo velho por muito tempo
          "cache-control": "public, max-age=0, s-maxage=3600",
        },
      });
    }

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
