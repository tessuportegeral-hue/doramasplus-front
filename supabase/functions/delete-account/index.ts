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
    // as demais abaixo são NO ACTION e bloqueiam o deleteUser se não forem limpas antes).
    // ✅ 26/07: isso rodava como 9 chamadas HTTP separadas sem checar erro em
    // nenhuma — uma falha no meio (rede, timeout) apagava subscriptions/
    // pix_payments/etc mas nunca chegava no deleteUser, deixando a conta
    // "zumbi" (login e profile vivos, assinatura sumida pra sempre, sem
    // aviso). Agora roda tudo dentro de uma única transação no Postgres
    // (delete_user_account_data): se qualquer delete falhar, reverte tudo
    // e a conta fica intacta pra tentar de novo.
    const { error: cleanupError } = await adminClient.rpc('delete_user_account_data', {
      target_user_id: userId,
    });
    if (cleanupError) {
      return new Response(JSON.stringify({ error: 'Erro ao limpar dados da conta: ' + cleanupError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
