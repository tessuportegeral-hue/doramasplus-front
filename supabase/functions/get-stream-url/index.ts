// supabase/functions/get-stream-url/index.ts
//
// Edge Function responsável por entregar a URL de streaming de um dorama
// com Token Authentication do Bunny (CDN/Storage e Stream).
//
// === ROLLOUT GATEADO ===
// Hoje só responde pra STREAM_TOKEN_TEST_EMAIL. Os demais usuários NÃO
// chamam essa função — o frontend continua lendo `bunny_url` direto da
// tabela `doramas` enquanto a feature está em validação.
// Para liberar pra todos: STREAM_TOKEN_TEST_EMAIL = null
// =======================
//
// Quando o gate libera, o frontend NÃO lê mais bunny_url/bunny_stream_url
// direto da tabela. Em vez disso, chama esta função, que:
//   1. Valida o JWT do usuário
//   2. Confirma que é a conta de teste (STREAM_TOKEN_TEST_EMAIL)
//   3. (TODO) Confirma assinatura premium ativa
//   4. Busca a URL crua no banco via service_role
//   5. Escolhe entre normal/iphone
//   6. (TODO) Assina com a chave do Bunny apropriada (CDN vs Stream)
//   7. Devolve { url, expiresAt, playerType, mode } com TTL de 15min
//
// Deploy: supabase functions deploy get-stream-url
//
// Secrets esperadas (configurar antes de habilitar signing):
//   BUNNY_CDN_TOKEN_KEY       — URL Token Auth Key do Pull Zone (Storage)
//   BUNNY_STREAM_TOKEN_KEY    — Token Auth Key da Stream Library

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ====== GATE DE TESTE ======
// Restringe a função à conta de teste durante o rollout. Quando o fluxo
// estiver estável em todos os players (HLS, MP4, iframe Bunny), mudar
// pra null pra liberar a todos os usuários autenticados.
// Pattern espelhado em evict-session/index.ts.
const STREAM_TOKEN_TEST_EMAIL: string | null = 'tesagencia@gmail.com'
// ============================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STREAM_TTL_SECONDS = 15 * 60 // 15 minutos

// ====== SIGNING (TODO) ======
//
// async function signCdnUrl(rawUrl: string, key: string, ttlSec: number, pathPrefix?: string) {
//   // base64url( sha256_raw( key + path + expires [+ path_allowed] ) )
//   // Para HLS: passar o diretório como pathPrefix pra cobrir todos os .ts
// }
//
// async function signStreamEmbed(embedUrl: string, key: string, ttlSec: number) {
//   // sha256_hex( key + videoId + expires )
//   // videoId extraído de /embed/<libId>/<videoId>
// }
//
// ============================

function detectPlayerType(url: string): 'hls' | 'mp4' | 'iframe' | 'video' | 'none' {
  const u = (url || '').toLowerCase()
  if (!u) return 'none'
  if (u.includes('.m3u8')) return 'hls'
  if (u.includes('.mp4')) return 'mp4'
  if (u.includes('iframe.mediadelivery.net')) return 'iframe'
  if (u.includes('/embed/')) return 'iframe'
  if (u.startsWith('http')) return 'video'
  return 'none'
}

function jsonResp(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1) Auth via JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResp(401, { error: 'Unauthorized' })
    }
    const jwt = authHeader.replace('Bearer ', '')

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !user) {
      return jsonResp(401, { error: 'Invalid token' })
    }

    // 2) Gate de teste — espelho do pattern em evict-session
    if (STREAM_TOKEN_TEST_EMAIL !== null && user.email !== STREAM_TOKEN_TEST_EMAIL) {
      return jsonResp(403, { error: 'Forbidden' })
    }

    // 3) Body
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const doramaId = String(body?.dorama_id || '').trim()
    const mode = body?.mode === 'iphone' ? 'iphone' : 'normal'
    if (!doramaId) {
      return jsonResp(400, { error: 'dorama_id required' })
    }

    // 4) Premium check
    // TODO: validar assinatura ativa em `subscriptions`. Hoje comentado
    // pra não bloquear testes com tesagencia.

    // 5) Fetch dorama (service_role bypassa RLS)
    // IMPORTANTE: a tabela `doramas` só tem bunny_url e bunny_stream_url.
    // NÃO incluir bunny_embed_url no select — coluna não existe no schema
    // e PostgREST retorna erro, derrubando a função pra todos.
    const { data: dorama, error: dorErr } = await admin
      .from('doramas')
      .select('id, bunny_url, bunny_stream_url')
      .eq('id', doramaId)
      .single()

    if (dorErr || !dorama) {
      return jsonResp(404, { error: 'Dorama not found' })
    }

    // 6) Escolhe URL conforme mode — mesma lógica do useMemo no client
    const normal = (dorama.bunny_url || dorama.bunny_stream_url || '').trim()
    const iphone = (dorama.bunny_stream_url || dorama.bunny_url || '').trim()
    const rawUrl = mode === 'iphone' ? iphone : normal

    if (!rawUrl) {
      return jsonResp(404, { error: 'No stream URL available' })
    }

    // 7) Assina
    // TODO: substituir o `url = rawUrl` por chamada à função de signing
    // apropriada conforme o domínio:
    //   - *.b-cdn.net                  → signCdnUrl(rawUrl, BUNNY_CDN_TOKEN_KEY, TTL, pathPrefix)
    //   - iframe.mediadelivery.net     → signStreamEmbed(rawUrl, BUNNY_STREAM_TOKEN_KEY, TTL)
    //
    // Por enquanto devolve URL CRUA — permite validar end-to-end o gate
    // (frontend chamando a função só pra tesagencia, demais usuários no
    // caminho antigo) antes do signing real entrar.
    const expiresAt = Math.floor(Date.now() / 1000) + STREAM_TTL_SECONDS
    const url = rawUrl

    return jsonResp(200, {
      url,
      expiresAt,
      playerType: detectPlayerType(url),
      mode,
    })
  } catch (err) {
    console.error('[get-stream-url] unexpected error:', err)
    return jsonResp(500, { error: 'Internal error' })
  }
})
