// supabase/functions/sitemap/index.ts
//
// Edge Function que gera o sitemap.xml dinâmico do DoramasPlus.
//
// Busca todos os doramas da tabela `doramas` (paginando, pra suportar >1000 linhas)
// e devolve um XML com:
//   - páginas estáticas públicas (/, /landing, /como-funciona, /privacidade)
//   - todos os /dorama/<slug>
//
// Deploy:
//   supabase functions deploy sitemap --no-verify-jwt
//
// O --no-verify-jwt é obrigatório: o Google/crawlers não mandam JWT.
//
// Servido em produção via rewrite do Vercel:
//   /sitemap.xml  ->  https://<project>.supabase.co/functions/v1/sitemap

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SITE_URL = 'https://doramasplus.com.br'
const PAGE_SIZE = 1000

const STATIC_URLS: Array<{ loc: string; changefreq: string; priority: string }> = [
  { loc: '/',              changefreq: 'daily',   priority: '1.0' },
  { loc: '/landing',       changefreq: 'weekly',  priority: '0.8' },
  { loc: '/como-funciona', changefreq: 'monthly', priority: '0.6' },
  { loc: '/privacidade',   changefreq: 'yearly',  priority: '0.3' },
]

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Pagina porque o catálogo já tem ~1.700 doramas e o default do PostgREST é 1000
    const doramas: Array<{ slug: string; created_at: string | null }> = []
    let from = 0
    while (true) {
      const to = from + PAGE_SIZE - 1
      const { data, error } = await supabase
        .from('doramas')
        .select('slug, created_at')
        .not('slug', 'is', null)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) {
        console.error('[sitemap] erro ao buscar doramas:', error)
        return new Response(`Erro: ${error.message}`, { status: 500 })
      }

      if (!data || data.length === 0) break
      doramas.push(...(data as typeof doramas))

      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const nowIso = new Date().toISOString()
    const parts: string[] = []
    parts.push('<?xml version="1.0" encoding="UTF-8"?>')
    parts.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')

    for (const s of STATIC_URLS) {
      parts.push('  <url>')
      parts.push(`    <loc>${SITE_URL}${s.loc}</loc>`)
      parts.push(`    <lastmod>${nowIso}</lastmod>`)
      parts.push(`    <changefreq>${s.changefreq}</changefreq>`)
      parts.push(`    <priority>${s.priority}</priority>`)
      parts.push('  </url>')
    }

    for (const d of doramas) {
      const slug = (d.slug || '').trim()
      if (!slug) continue
      const lastmod = d.created_at || nowIso
      parts.push('  <url>')
      parts.push(`    <loc>${SITE_URL}/dorama/${escapeXml(slug)}</loc>`)
      parts.push(`    <lastmod>${lastmod}</lastmod>`)
      parts.push('    <changefreq>weekly</changefreq>')
      parts.push('    <priority>0.7</priority>')
      parts.push('  </url>')
    }

    parts.push('</urlset>')

    return new Response(parts.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        // Cache 1h no CDN/edge, permite servir stale por 24h se origem cair
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('[sitemap] erro inesperado:', err)
    return new Response('Internal error', { status: 500 })
  }
})
