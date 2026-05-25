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
const STREAM_TOKEN_TEST_EMAIL: string | null = null
// ============================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STREAM_TTL_SECONDS = 15 * 60 // 15 minutos

// ====== SIGNING ======

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Bunny CDN / Storage Pull Zone Token Authentication
//   token = base64url( sha256_raw( security_key + path + expires ) )
//
// Para HLS (.m3u8): assina o diretório do playlist via `token_path`. Com
// isso, todos os segmentos .ts / .m4s sob esse diretório passam a
// validação com o MESMO token — caso contrário cada segmento daria 401.
// Para .mp4 / outros: assina o path exato do arquivo.
async function signCdnUrl(
  rawUrl: string,
  key: string,
  ttlSec: number,
): Promise<{ url: string; expiresAt: number }> {
  const u = new URL(rawUrl)
  const expires = Math.floor(Date.now() / 1000) + ttlSec

  const isHls = u.pathname.toLowerCase().endsWith('.m3u8')
  const signedPath = isHls
    ? u.pathname.replace(/[^/]+$/, '') // diretório (ex.: /abc-123/def/)
    : u.pathname

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key + signedPath + String(expires)),
  )
  const token = base64UrlEncode(new Uint8Array(digest))

  u.searchParams.set('token', token)
  u.searchParams.set('expires', String(expires))
  if (isHls) {
    u.searchParams.set('token_path', signedPath)
  }

  return { url: u.toString(), expiresAt: expires }
}

// Bunny Stream Library Token Authentication (iframe.mediadelivery.net)
//   token = sha256_hex( token_auth_key + videoId + expires )
//
// videoId é o último segmento do path /embed/<libraryId>/<videoId>.
// Token vai em hex (não base64).
async function signStreamEmbed(
  embedUrl: string,
  key: string,
  ttlSec: number,
): Promise<{ url: string; expiresAt: number }> {
  const u = new URL(embedUrl)
  const parts = u.pathname.split('/').filter(Boolean)
  const videoId = parts[parts.length - 1]
  if (!videoId) {
    throw new Error('signStreamEmbed: videoId not found in URL path')
  }

  const expires = Math.floor(Date.now() / 1000) + ttlSec
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key + videoId + String(expires)),
  )
  const token = bytesToHex(new Uint8Array(digest))

  u.searchParams.set('token', token)
  u.searchParams.set('expires', String(expires))

  return { url: u.toString(), expiresAt: expires }
}

// =====================

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

    // 7) Assina conforme o domínio da URL
    let url: string
    let expiresAt: number

    try {
      const host = new URL(rawUrl).hostname.toLowerCase()

      if (host.endsWith('.b-cdn.net')) {
        const cdnKey = Deno.env.get('BUNNY_CDN_TOKEN_KEY')
        if (!cdnKey) {
          console.error('[get-stream-url] BUNNY_CDN_TOKEN_KEY missing in env')
          return jsonResp(500, { error: 'Server misconfigured' })
        }
        const signed = await signCdnUrl(rawUrl, cdnKey, STREAM_TTL_SECONDS)
        url = signed.url
        expiresAt = signed.expiresAt
      } else if (host === 'iframe.mediadelivery.net') {
        const streamKey = Deno.env.get('BUNNY_STREAM_TOKEN_KEY')
        if (!streamKey) {
          console.error('[get-stream-url] BUNNY_STREAM_TOKEN_KEY missing in env')
          return jsonResp(500, { error: 'Server misconfigured' })
        }
        const signed = await signStreamEmbed(rawUrl, streamKey, STREAM_TTL_SECONDS)
        url = signed.url
        expiresAt = signed.expiresAt
      } else {
        // Domínio fora do esperado: deixa passar sem assinar pra não quebrar
        // (mesmo comportamento da versão anterior). Logamos pra investigar.
        console.warn('[get-stream-url] unrecognized host, returning unsigned:', host)
        url = rawUrl
        expiresAt = Math.floor(Date.now() / 1000) + STREAM_TTL_SECONDS
      }
    } catch (signErr) {
      console.error('[get-stream-url] signing failed:', signErr)
      return jsonResp(500, { error: 'Failed to sign URL' })
    }

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
