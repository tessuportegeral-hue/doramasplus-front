// supabase/functions/update-user-email/index.ts
//
// Edge Function que troca o email de login de um usuário criado via
// "conta rápida" (email no formato <telefone>@doramasplus.com) pelo
// email real que ele informar.
//
// Usa service_role (nunca exposto ao frontend) para:
//   1. Validar o JWT do usuário (quem está pedindo a troca)
//   2. Validar o formato do novo email
//   3. Garantir que o email ainda não está em uso em auth.users
//   4. Atualizar auth.users via admin.updateUserById (email já confirmado)
//   5. Espelhar o novo email em public.profiles
//
// Pré-requisito no painel Supabase:
//   Authentication → Email → DESMARCAR "Confirm email changes"
//   (com email_confirm:true abaixo a troca já vale na hora, sem link)
//
// Deploy: supabase functions deploy update-user-email

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Validação simples de formato. A unicidade é garantida pelo GoTrue.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

    // Cliente admin — service_role, nunca chega ao frontend
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !user) {
      return jsonResp(401, { error: 'Invalid token' })
    }

    // 2) Body + validação de formato
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const newEmail = String(body?.email || '').trim().toLowerCase()

    if (!newEmail || !EMAIL_RE.test(newEmail)) {
      return jsonResp(400, { error: 'Email inválido.' })
    }

    // Se o email for igual ao atual, não faz nada (evita erro à toa)
    if (newEmail === String(user.email || '').trim().toLowerCase()) {
      return jsonResp(400, { error: 'Esse já é o seu email atual.' })
    }

    // 3) Checa se o email já existe em auth.users.
    // getUserByEmail é a forma autoritativa; se achar OUTRO usuário, bloqueia.
    try {
      const { data: existing } = await admin.auth.admin.getUserByEmail(newEmail)
      if (existing?.user && existing.user.id !== user.id) {
        return jsonResp(409, { error: 'Esse email já está em uso' })
      }
    } catch (_e) {
      // getUserByEmail lança/retorna erro quando não acha — nesse caso o
      // email está livre e seguimos. A unicidade ainda é reforçada no passo 4.
    }

    // 4) Atualiza auth.users. email_confirm:true marca o novo email como
    // confirmado na hora (combina com "Confirm email changes" desmarcado).
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
      email: newEmail,
      email_confirm: true,
    })

    if (updErr) {
      const msg = String(updErr.message || '').toLowerCase()
      const isDup =
        (updErr as { code?: string })?.code === 'email_exists' ||
        msg.includes('already been registered') ||
        msg.includes('already registered') ||
        msg.includes('already in use') ||
        msg.includes('duplicate')

      if (isDup) {
        return jsonResp(409, { error: 'Esse email já está em uso' })
      }
      console.error('[update-user-email] updateUserById error:', updErr)
      return jsonResp(500, { error: 'Não foi possível atualizar o email.' })
    }

    // 5) Espelha em public.profiles (não falha hard se der erro aqui — o
    // auth já foi atualizado, que é o que importa pro login).
    const { error: profErr } = await admin
      .from('profiles')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (profErr) {
      console.error('[update-user-email] profiles update error:', profErr)
    }

    return jsonResp(200, { ok: true, email: newEmail })
  } catch (err) {
    console.error('[update-user-email] unexpected error:', err)
    return jsonResp(500, { error: 'Internal error' })
  }
})
