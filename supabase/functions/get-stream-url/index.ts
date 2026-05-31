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
// === ACESSO ===
// Dois caminhos de autorização:
//   A) Usuário autenticado (JWT válido) — caminho premium/teste.
//   B) Teste grátis ANÔNIMO (body.free_trial === true) — sem JWT. Valida
//      o trial por IP na tabela `free_trials` (mesma da edge `free-trial`)
//      e assina a URL com TTL CAPADO ao tempo restante do trial, pra que o
//      link assinado não sobreviva aos 10 min de teste.
//
// IMPORTANTE: esta função precisa ser deployada com `verify_jwt: false`
// (igual à `free-trial`), senão o gateway do Supabase bloqueia o anônimo
// antes do código rodar. O auth é feito DENTRO da função.
//
// Fluxo:
//   1. Tenta resolver o usuário via JWT (opcional)
//   2. Autoriza: usuário autenticado (gate de teste) OU trial por IP
//   3. (TODO) Confirma assinatura premium ativa (caminho autenticado)
//   4. Busca a URL crua no banco via service_role
//   5. Escolhe entre normal/iphone
//   6. Assina com a chave do Bunny apropriada (CDN vs Stream)
//   7. Devolve { url, expiresAt, playerType, mode }
//
// Deploy: supabase functions deploy get-stream-url --no-verify-jwt
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

const STREAM_TTL_SECONDS = 4 * 60 * 60 // 4 horas (cobre filme inteiro + pausa)

// CDN hostname da Bunny Stream Library 549745 (Pull Zone 4914616, separado
// do Pull Zone do Storage). Esse hostname é gerado pelo Bunny e protegido
// pela Token Auth Key da Library (BUNNY_STREAM_TOKEN_KEY).
const BUNNY_STREAM_CDN_HOSTNAME = 'vz-d2218705-557.b-cdn.net'

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

  // Bunny CDN computa o hash sobre o path DECODED. `u.pathname` mantém
  // %20 / %C3%A7, então se hashearmos com o pathname cru o token nunca
  // bate em arquivos com espaço/acento no nome (ex.: "Dilemas de um
  // amor Eterno.mp4") e o Bunny retorna 401.
  const decodedPath = decodeURIComponent(u.pathname)
  const isHls = decodedPath.toLowerCase().endsWith('.m3u8')
  const signedPath = isHls
    ? decodedPath.replace(/[^/]+$/, '') // diretório com trailing slash (ex.: /abc-123/def/)
    : decodedPath

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

// Bunny Stream Library — assina a URL HLS direto do CDN da library, em
// vez do iframe. Vantagem: o frontend toca no <video> nativo via HLS.js,
// recupera tracking preciso (timeupdate) e resume nativo (currentTime=N).
//
// Input:  https://iframe.mediadelivery.net/embed/<libraryId>/<videoId>
// Output: https://<cdnHostname>/<videoId>/playlist.m3u8?token=...&expires=...&token_path=...
//
// Algoritmo: igual ao URL Token Authentication de Pull Zone padrão
// (NÃO o algoritmo hex+videoId do iframe embed):
//   token = base64url( sha256_raw( token_auth_key + token_path + expires ) )
//   token_path = "/<videoId>/" (diretório com trailing slash)
//
// A chave usada é a BUNNY_STREAM_TOKEN_KEY (mesma do iframe), mas o
// algoritmo é diferente porque o Pull Zone do Stream segue o padrão CDN.
// O token_path no diretório cobre playlist.m3u8 + todos os segmentos.
async function signStreamHls(
  embedUrl: string,
  key: string,
  ttlSec: number,
  cdnHostname: string,
): Promise<{ url: string; expiresAt: number }> {
  const u = new URL(embedUrl)
  const parts = u.pathname.split('/').filter(Boolean)
  const videoId = parts[parts.length - 1]
  if (!videoId) {
    throw new Error('signStreamHls: videoId not found in URL path')
  }

  const tokenPath = `/${videoId}/`
  const expires = Math.floor(Date.now() / 1000) + ttlSec
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key + tokenPath + String(expires)),
  )
  const token = base64UrlEncode(new Uint8Array(digest))

  const hls = new URL(`https://${cdnHostname}/${videoId}/playlist.m3u8`)
  hls.searchParams.set('token', token)
  hls.searchParams.set('expires', String(expires))
  hls.searchParams.set('token_path', tokenPath)
  return { url: hls.toString(), expiresAt: expires }
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
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1) Auth via JWT — OPCIONAL. O caminho de teste grátis é anônimo, então
    // não rejeitamos aqui se não houver token; só tentamos resolver o usuário.
    const authHeader = req.headers.get('Authorization')
    const jwt = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : ''
    let user: { email?: string } | null = null
    if (jwt) {
      const { data } = await admin.auth.getUser(jwt)
      user = data?.user ?? null
    }

    // 2) Body
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const doramaId = String(body?.dorama_id || '').trim()
    const mode = body?.mode === 'iphone' ? 'iphone' : 'normal'
    const freeTrial = body?.free_trial === true
    if (!doramaId) {
      return jsonResp(400, { error: 'dorama_id required' })
    }

    // 3) Autorização — usuário autenticado OU teste grátis por IP.
    // ttlSeconds começa no padrão e é capado ao restante do trial no caminho B.
    let ttlSeconds = STREAM_TTL_SECONDS

    if (user) {
      // Caminho A: autenticado. Gate de teste — espelho do pattern em evict-session.
      if (STREAM_TOKEN_TEST_EMAIL !== null && user.email !== STREAM_TOKEN_TEST_EMAIL) {
        return jsonResp(403, { error: 'Forbidden' })
      }
      // TODO: validar assinatura ativa em `subscriptions`. Hoje comentado
      // pra não bloquear testes com tesagencia.
    } else if (freeTrial) {
      // Caminho B: teste grátis anônimo. Valida o trial por IP na mesma tabela
      // `free_trials` usada pela edge `free-trial` (verify_jwt: false).
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
      const { data: trial } = await admin
        .from('free_trials')
        .select('expires_at')
        .eq('ip', ip)
        .maybeSingle()

      const remaining = trial
        ? Math.max(0, Math.floor((new Date(trial.expires_at).getTime() - Date.now()) / 1000))
        : 0

      if (remaining <= 0) {
        return jsonResp(403, { error: 'Trial expired or not started' })
      }

      // Capa o TTL ao restante do trial (+60s de folga pra não cortar no fim)
      // pra que o link assinado não sobreviva aos 10 min de teste grátis.
      ttlSeconds = Math.min(STREAM_TTL_SECONDS, remaining + 60)
    } else {
      // Sem usuário e sem flag de trial: não autorizado.
      return jsonResp(401, { error: 'Unauthorized' })
    }

    // 4) Fetch dorama (service_role bypassa RLS)
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

    // 5) Escolhe URL conforme mode — mesma lógica do useMemo no client
    const normal = (dorama.bunny_url || dorama.bunny_stream_url || '').trim()
    const iphone = (dorama.bunny_stream_url || dorama.bunny_url || '').trim()
    const rawUrl = mode === 'iphone' ? iphone : normal

    if (!rawUrl) {
      return jsonResp(404, { error: 'No stream URL available' })
    }

    // 6) Assina conforme o domínio da URL
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
        const signed = await signCdnUrl(rawUrl, cdnKey, ttlSeconds)
        url = signed.url
        expiresAt = signed.expiresAt
      } else if (host === 'iframe.mediadelivery.net') {
        const streamKey = Deno.env.get('BUNNY_STREAM_TOKEN_KEY')
        if (!streamKey) {
          console.error('[get-stream-url] BUNNY_STREAM_TOKEN_KEY missing in env')
          return jsonResp(500, { error: 'Server misconfigured' })
        }
        // Rollback pro iframe signing enquanto investigamos o algoritmo
        // correto do HLS direto. signStreamHls fica pronta no código pra
        // quando confirmarmos a chave/algoritmo do Pull Zone 4914616.
        const signed = await signStreamEmbed(rawUrl, streamKey, ttlSeconds)
        url = signed.url
        expiresAt = signed.expiresAt
      } else {
        // Domínio fora do esperado: deixa passar sem assinar pra não quebrar
        // (mesmo comportamento da versão anterior). Logamos pra investigar.
        console.warn('[get-stream-url] unrecognized host, returning unsigned:', host)
        url = rawUrl
        expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
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
