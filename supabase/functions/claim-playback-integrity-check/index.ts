// claim-playback-integrity-check: roda periodicamente via pg_cron. Confere
// se o claim-playback está de fato travando reprodução simultânea —
// procura contas com mais dispositivos "assistindo agora"
// (playback_sessions) do que o plano permite
// (subscriptions.max_concurrent_streams). Se achar, é sinal de que a
// trava parou de funcionar (bug, deploy quebrado, etc). Não corrige nada
// sozinho — só avisa por email pra checagem manual (mesmo padrão do
// asaas-integrity-check).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";
const CRON_SECRET = "dp_claim_integrity_v7n2k5";

const CHECK_SQL = `
  select
    ps.user_id,
    p.email,
    count(*) as active_devices,
    coalesce(max(s.max_concurrent_streams), 1) as allowed,
    string_agg(coalesce(ps.device_name, 'desconhecido') || ' (' || coalesce(ps.ip, '?') || ')', ', ') as devices
  from public.playback_sessions ps
  join public.profiles p on p.id = ps.user_id
  left join lateral (
    select max_concurrent_streams
    from public.subscriptions
    where user_id = ps.user_id
    order by current_period_end desc nulls last
    limit 1
  ) s on true
  group by ps.user_id, p.email
  having count(*) > coalesce(max(s.max_concurrent_streams), 1)
`;

async function sendEmail(rows: any[]) {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  const list = rows
    .map(
      (r) =>
        `• ${r.email} — ${r.active_devices} dispositivos ativos (permitido: ${r.allowed}) — ${r.devices}`
    )
    .join("<br>");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: `🚨 DoramasPlus — claim-playback não travou ${rows.length} conta(s)`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
        <p>A checagem de integridade do <b>claim-playback</b> encontrou conta(s) com mais dispositivos assistindo ao mesmo tempo do que o plano permite — sinal de que a trava de reprodução simultânea pode ter parado de funcionar.</p>
        <p>${list}</p>
        <p style="color:#888">Não corrige nada automaticamente. Verificar se o claim-playback está retornando erro (get_logs), se algum deploy recente quebrou a lógica de bloqueio, ou se é falso positivo (corrida momentânea entre dois dispositivos, ex: um force acontecendo bem na hora da checagem).</p>
      </div>`,
    }),
  }).catch((e) => console.error("[claim-playback-integrity-check] email fail:", String(e)));
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

    if (rows.length > 0) {
      await sendEmail(rows);
    }

    return new Response(
      JSON.stringify({ ok: true, violations: rows.length, run_at: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "internal", details: String(e) }), { status: 500 });
  }
});
