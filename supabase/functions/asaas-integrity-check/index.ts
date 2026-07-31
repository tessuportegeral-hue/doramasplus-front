// asaas-integrity-check: roda 1x/dia via pg_cron. Confere pix_payments
// (provider=asaas, status=paid) dos últimos 2 dias contra subscriptions —
// se não existe assinatura ativa cujo end_at é POSTERIOR ao pagamento, é
// sinal de que o pagamento pode ter ficado represado (ex: fila do webhook
// da Asaas pausada após falhas consecutivas, ver asaas-webhook-queue-pause).
// Não corrige nada sozinho — só detecta e manda email pra revisão manual
// (ver CLAUDE.md: nunca mexer em lógica de pagamento sem autorização).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";
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

// ✅ 31/07: manda email TODO DIA, mesmo sem achado — antes só avisava quando
// tinha divergência, o que ficava indistinguível de "o cron parou de rodar"
// (silêncio por design parecia bug). Agora sempre confirma que rodou.
async function sendEmail(rows: any[]) {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  const hasIssues = rows.length > 0;
  const list = rows
    .map(
      (r) =>
        `• ${r.email} — R$ ${(r.amount_cents / 100).toFixed(2)} (${r.plan}) — pago em ${r.pix_created_at} — order_nsu: ${r.order_nsu}`
    )
    .join("<br>");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: hasIssues
        ? `⚠️ Asaas: ${rows.length} pagamento(s) pago(s) sem assinatura ativa correspondente`
        : `✅ Asaas: checagem diária ok, 0 problemas`,
      html: hasIssues
        ? `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
        <p>Checagem diária de integridade Asaas encontrou pagamento(s) marcados como <b>pagos</b> nas últimas 48h sem uma assinatura ativa que cubra a data do pagamento — possível fila do webhook pausada ou falha na ativação.</p>
        <p>${list}</p>
        <p style="color:#888">Isso não corrige nada automaticamente. Verificar manualmente no painel Asaas e/ou reativar a fila de webhooks se estiver pausada.</p>
      </div>`
        : `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
        <p>Checagem diária de integridade Asaas rodou agora e não encontrou nenhum pagamento pago sem assinatura ativa correspondente nas últimas 48h. Tudo certo. ✅</p>
      </div>`,
    }),
  }).catch((e) => console.error("[asaas-integrity-check] email fail:", String(e)));
}

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

    await sendEmail(rows);

    return new Response(
      JSON.stringify({ ok: true, mismatches: rows.length, run_at: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "internal", details: String(e) }), { status: 500 });
  }
});
