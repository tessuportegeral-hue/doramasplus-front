// supabase/functions/admin-analytics/index.ts
//
// Busca métricas de pix_payments usando service_role (bypassa RLS).
// Só executa se o JWT pertencer a um usuário com is_admin = true.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jwt = authHeader.replace('Bearer ', '')

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verifica identidade e permissão de admin
    const { data: { user }, error: userErr } = await adminClient.auth.getUser(jwt)
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()

    if (profileErr || !profile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { period_start, period_end } = await req.json()

    const now = new Date()
    const d30ago = new Date(now.getTime() - 30 * 86400000)
    const d60ago = new Date(now.getTime() - 60 * 86400000)

    // Todas as queries em paralelo
    const [
      { count: pendingNow },
      { count: pendingInPeriod },
      { data: soldData },
      { data: baseData },
    ] = await Promise.all([
      adminClient.from('pix_payments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      adminClient.from('pix_payments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .gte('created_at', period_start)
        .lte('created_at', period_end),
      adminClient.from('pix_payments')
        .select('amount_cents')
        .eq('status', 'paid')
        .gte('created_at', period_start)
        .lte('created_at', period_end),
      adminClient.from('pix_payments')
        .select('user_id')
        .eq('status', 'paid')
        .gte('created_at', d60ago.toISOString())
        .lt('created_at', d30ago.toISOString()),
    ])

    // Retenção D30: dos que pagaram entre d60-d30, quem voltou nos últimos 30 dias
    const baseIds = [...new Set((baseData ?? []).map((r: any) => r.user_id))]
    let d30Retained = 0
    if (baseIds.length > 0) {
      const { data: retData } = await adminClient.from('pix_payments')
        .select('user_id')
        .eq('status', 'paid')
        .gte('created_at', d30ago.toISOString())
        .in('user_id', baseIds)
      d30Retained = new Set((retData ?? []).map((r: any) => r.user_id)).size
    }

    return new Response(
      JSON.stringify({
        pending_now: pendingNow ?? 0,
        pending_in_period: pendingInPeriod ?? 0,
        sold_records: soldData ?? [],
        d30_base: baseIds.length,
        d30_retained: d30Retained,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[admin-analytics] unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
