// asaas-integrity-check: roda 1x/dia via pg_cron. Confere pix_payments
// (provider=asaas, status=paid) dos últimos 2 dias contra subscriptions —
// se não existe assinatura ativa cujo end_at é POSTERIOR ao pagamento, é
// sinal de que o pagamento pode ter ficado represado (ex: fila do webhook
// da Asaas pausada após falhas consecutivas, ver asaas-webhook-queue-pause).
// Não corrige nada sozinho — só detecta.
//
// ✅ 31/07: parou de mandar email próprio — agora é só uma peça consultada
// pelo daily-integrity-report, que junta Asaas/Stripe/InfinityPay/Claim/etc
// num único email diário (evita "monte de email" separado toda manhã).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = "dp_asaas_integrity_x3f8q1";

const CHECK_SQL = `
  select pp.order_nsu, pp.user_id, p.email, pp.amount_cents, pp.plan,
         pp.created_at as pix_created_at,
         s.status as current_sub_status, s.end_at as current_sub_end_at
  from pix_payments pp
  join profiles p on p.id = pp.user_id
  left join lateral (
    select s2.status, s2.end_at
    from subscriptions s2
    where s2.user_id = pp.user_id
      and s2.status = 'active'
      and s2.end_at > pp.created_at
    order by s2.end_at desc
    limit 1
  ) s on true
  where pp.provider = 'asaas'
    and pp.status = 'paid'
    and pp.created_at > now() - interval '2 days'
    and s.status is null
  order by pp.created_at desc
`;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ q: CHECK_SQL }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return new Response(JSON.stringify({ ok: false, error: "query_failed", details: text }), { status: 500 });
    }

    const data = await resp.json().catch(() => null);
    const rows: any[] = Array.isArray(data) ? data : [];

    return new Response(
      JSON.stringify({ ok: true, mismatches: rows.length, rows, run_at: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "internal", details: String(e) }), { status: 500 });
  }
});
