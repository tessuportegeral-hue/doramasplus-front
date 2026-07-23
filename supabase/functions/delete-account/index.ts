import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Cliente com a chave do usuário (para verificar autenticação)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Pega o usuário autenticado
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Usuário não autenticado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    // Cliente admin para deletar dados
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Deleta dados do usuário em todas as tabelas com FK para auth.users
    // (profiles tem ON DELETE CASCADE, não precisa deletar manualmente;
    // as demais abaixo são NO ACTION e bloqueiam o deleteUser se não forem limpas antes)
    await adminClient.from('watch_history').delete().eq('user_id', userId);
    await adminClient.from('active_sessions').delete().eq('user_id', userId);
    await adminClient.from('subscriptions').delete().eq('user_id', userId);
    await adminClient.from('pix_payments').delete().eq('user_id', userId);
    await adminClient.from('subscriptions_snapshot').delete().eq('user_id', userId);
    await adminClient.from('dora_conversations').delete().eq('user_id', userId);
    await adminClient.from('daily_active_users').delete().eq('user_id', userId);
    await adminClient.from('referrals').delete().eq('referrer_id', userId);
    await adminClient.from('referrals').delete().eq('referred_id', userId);
    // Perfis de terceiros que foram indicados por este usuário: limpa a referência
    // (não pode deletar o perfil de outra pessoa, só desvincular)
    await adminClient.from('profiles').update({ referred_by: null }).eq('referred_by', userId);

    // Deleta o usuário do auth
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(JSON.stringify({ error: 'Erro ao deletar usuário: ' + deleteError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, message: 'Conta deletada com sucesso' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Erro interno: ' + error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
