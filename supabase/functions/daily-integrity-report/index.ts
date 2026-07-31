// daily-integrity-report: roda 1x/dia via pg_cron (8h BRT) e manda UM ÚNICO
// email juntando todas as checagens de integridade — antes cada uma
// (Asaas, Stripe) mandava seu próprio email, o que ia virar um monte de
// emails separados toda manhã conforme mais checagens fossem adicionadas.
//
// Chama asaas-integrity-check, stripe-active-audit e
// claim-playback-integrity-check (que continuam existindo e podem ser
// chamadas isoladamente se precisar) e roda mais 4 checagens novas aqui
// dentro: InfinityPay (mesmo padrão do Asaas), indicação não refletida no
// end_at, evento de compra não enviado pro Meta CAPI, e resposta do admin
// na Dora não entregue.
//
// Watch-history é só um heurístico best-effort (compara quantidade de
// espectadores vs quantidade de gravações no watch_history no mesmo dia) —
// não é uma prova definitiva de falha, só um sinal pra investigar se cair
// muito fora do normal.
//
// Não corrige nada sozinho — só detecta e reporta (ver CLAUDE.md: nunca
// mexer em lógica de pagamento sem autorização).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";
const CRON_SECRET = "dp_daily_report_m8q4x1";

// Mesma anon key hardcoded já usada em outros crons deste projeto
// (ex.: jobid 42/43/68) — necessária pra chamar functions com verify_jwt:true.
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM";

type Section = {
  title: string;
  ok: boolean;
  summary: string;
  details?: string;
  bestEffort?: boolean;
};

async function runSql(sql: string): Promise<any[]> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ q: sql }),
  });
  if (!resp.ok) throw new Error(`sql_failed: ${await resp.text().catch(() => "")}`);
  const data = await resp.json().catch(() => null);
  return Array.isArray(data) ? data : [];
}

async function callFunction(slug: string, cronSecret: string, useAuth: boolean): Promise<any> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
      ...(useAuth ? { Authorization: `Bearer ${ANON_KEY}` } : {}),
    },
    body: JSON.stringify({}),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`${slug}_failed: ${JSON.stringify(data)}`);
  return data;
}

async function checkAsaas(): Promise<Section> {
  const data = await callFunction("asaas-integrity-check", "dp_asaas_integrity_x3f8q1", false);
  const rows: any[] = data?.rows || [];
  const ok = rows.length === 0;
  return {
    title: "Asaas — pagamentos pagos sem assinatura ativa",
    ok,
    summary: ok ? "0 problemas" : `${rows.length} pagamento(s) sem assinatura ativa correspondente`,
    details: ok
      ? undefined
      : rows.map((r) => `${r.email} — R$ ${(r.amount_cents / 100).toFixed(2)} (${r.plan}) — pago em ${r.pix_created_at} — order_nsu: ${r.order_nsu}`).join("<br>"),
  };
}

async function checkInfinitePay(): Promise<Section> {
  const rows = await runSql(`
    select pp.order_nsu, pp.user_id, p.email, pp.amount_cents, pp.plan, pp.created_at as pix_created_at
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
    where pp.provider = 'infinitepay'
      and pp.status = 'paid'
      and pp.created_at > now() - interval '2 days'
      and s.status is null
    order by pp.created_at desc
  `);
  const ok = rows.length === 0;
  return {
    title: "InfinityPay — pagamentos pagos sem assinatura ativa",
    ok,
    summary: ok ? "0 problemas" : `${rows.length} pagamento(s) sem assinatura ativa correspondente`,
    details: ok
      ? undefined
      : rows.map((r: any) => `${r.email} — R$ ${(r.amount_cents / 100).toFixed(2)} (${r.plan}) — pago em ${r.pix_created_at} — order_nsu: ${r.order_nsu}`).join("<br>"),
  };
}

async function checkStripe(): Promise<Section> {
  const data = await callFunction("stripe-active-audit", "dp_stripe_audit_q7z1w9r", true);
  const rows: any[] = data?.mismatch_rows || [];
  const ok = rows.length === 0;
  return {
    title: `Stripe — assinatura ativa no banco vs status real (${data?.checked ?? "?"} conferidas)`,
    ok,
    summary: ok ? "0 divergências" : `${rows.length} divergência(s)`,
    details: ok
      ? undefined
      : rows.map((r) => `user_id ${r.user_id} — banco diz "${r.db_status}", Stripe diz "${r.stripe_status}" — sub ${r.stripe_subscription_id}`).join("<br>"),
  };
}

async function checkClaimPlayback(): Promise<Section> {
  const data = await callFunction("claim-playback-integrity-check", "dp_claim_integrity_v7n2k5", false);
  const violations = data?.violations ?? 0;
  const ok = violations === 0;
  return {
    title: "Claim-playback — limite de dispositivos simultâneos",
    ok,
    summary: ok ? "0 contas acima do limite do plano" : `${violations} conta(s) com mais dispositivos que o permitido`,
    details: ok ? undefined : "Ver email de alerta em tempo real (mesma checagem roda a cada 15min) ou stripe_active_audit_log.",
  };
}

async function checkReferralCredit(): Promise<Section> {
  const rows = await runSql(`
    select r.id, r.referrer_id, r.referred_id, r.credited_at, p.email as referrer_email, s.end_at
    from referrals r
    join profiles p on p.id = r.referrer_id
    left join lateral (
      select s2.end_at from subscriptions s2 where s2.user_id = r.referrer_id order by s2.end_at desc nulls last limit 1
    ) s on true
    where r.status = 'credited'
      and r.credited_at > now() - interval '2 days'
      and (s.end_at is null or s.end_at < r.credited_at + interval '14 days')
  `);
  const ok = rows.length === 0;
  return {
    title: "Indicação — crédito de 15 dias não refletido no acesso",
    ok,
    summary: ok ? "0 problemas" : `${rows.length} indicação(ões) creditada(s) sem o bônus aparecer no end_at`,
    details: ok
      ? undefined
      : rows.map((r: any) => `${r.referrer_email} — creditado em ${r.credited_at} — end_at atual: ${r.end_at ?? "null"}`).join("<br>"),
  };
}

async function checkMetaCapi(): Promise<Section> {
  const rows = await runSql(`
    select order_nsu, user_id, provider, amount_cents, paid_at
    from pix_payments
    where status = 'paid'
      and provider in ('infinitepay', 'asaas')
      and paid_at > now() - interval '2 days'
      and coalesce(meta_sent, false) = false
  `);
  const ok = rows.length === 0;
  return {
    title: "Meta CAPI — evento de compra não enviado",
    ok,
    summary: ok ? "0 problemas" : `${rows.length} compra(s) paga(s) sem evento Purchase confirmado no Meta`,
    details: ok
      ? undefined
      : rows.map((r: any) => `${r.provider} — order_nsu ${r.order_nsu} — R$ ${(r.amount_cents / 100).toFixed(2)} — pago em ${r.paid_at}`).join("<br>"),
  };
}

async function checkDoraAdminDelivery(): Promise<Section> {
  const rows = await runSql(`
    select id, user_id, session_id, created_at
    from dora_conversations
    where role = 'admin'
      and delivered_at is null
      and created_at < now() - interval '1 hour'
      and created_at > now() - interval '2 days'
  `);
  const ok = rows.length === 0;
  return {
    title: "Dora — resposta do admin não entregue",
    ok,
    summary: ok ? "0 problemas" : `${rows.length} resposta(s) do painel /admin/dora sem confirmação de entrega há mais de 1h`,
    details: ok
      ? undefined
      : rows.map((r: any) => `session ${r.session_id} — enviada em ${r.created_at}`).join("<br>"),
  };
}

async function checkWatchHistoryHeuristic(): Promise<Section> {
  // ✅ 31/07: tentativa de heurístico (playback_sessions vs watch_history)
  // não se sustentou — playback_sessions cobre bem menos gente do que o
  // watch_history de fato atualiza (não são bases comparáveis, claim-playback
  // não roda em todo mundo que assiste). Fica só INFORMATIVO por enquanto
  // (sem veredito ok/problema fingido) até alguém desenhar um sinal
  // confiável de verdade pra "watch_history parou de gravar".
  const rows = await runSql(`
    select count(distinct user_id) as historico
    from watch_history
    where updated_at > now() - interval '1 day'
  `);
  const historico = Number(rows[0]?.historico ?? 0);
  return {
    title: "Watch-history — gravação de progresso",
    ok: true,
    bestEffort: true,
    summary: `${historico} pessoa(s) com histórico atualizado nas últimas 24h — só contexto, ainda não tem um sinal confiável de "parou de gravar"`,
  };
}

function buildEmailHtml(sections: Section[]): string {
  const anyIssue = sections.some((s) => !s.ok);
  const rows = sections
    .map((s) => {
      const icon = s.ok ? "✅" : "⚠️";
      const bestEffortTag = s.bestEffort ? ' <span style="color:#888;font-size:11px">(estimativa)</span>' : "";
      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #333;">
            <div style="font-size:14px;color:#fff;"><b>${icon} ${s.title}</b>${bestEffortTag}</div>
            <div style="font-size:13px;color:${s.ok ? "#2ecc71" : "#e74c3c"};margin-top:2px;">${s.summary}</div>
            ${s.details ? `<div style="font-size:12px;color:#bbb;margin-top:6px;line-height:1.5;">${s.details}</div>` : ""}
          </td>
        </tr>`;
    })
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#0f0f0f;padding:20px;">
      <h2 style="color:#fff;">📋 DoramasPlus — Relatório diário de integridade</h2>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <p style="color:#888;font-size:11px;margin-top:16px;">Não corrige nada automaticamente. Verificar manualmente cada item com problema antes de agir. Gerado às ${new Date().toISOString()}.</p>
    </div>`;
}

async function sendEmail(sections: Section[]) {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  const anyIssue = sections.some((s) => !s.ok);
  const issueCount = sections.filter((s) => !s.ok).length;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: anyIssue
        ? `⚠️ DoramasPlus — Relatório diário (${issueCount} item${issueCount > 1 ? "s" : ""} pra ver)`
        : `✅ DoramasPlus — Relatório diário (tudo ok)`,
      html: buildEmailHtml(sections),
    }),
  }).catch((e) => console.error("[daily-integrity-report] email fail:", String(e)));
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const checks: Array<[string, () => Promise<Section>]> = [
    ["asaas", checkAsaas],
    ["infinitepay", checkInfinitePay],
    ["stripe", checkStripe],
    ["claim_playback", checkClaimPlayback],
    ["referral", checkReferralCredit],
    ["meta_capi", checkMetaCapi],
    ["dora_admin", checkDoraAdminDelivery],
    ["watch_history", checkWatchHistoryHeuristic],
  ];

  const sections: Section[] = [];
  const errors: Record<string, string> = {};

  for (const [key, fn] of checks) {
    try {
      sections.push(await fn());
    } catch (e) {
      errors[key] = String(e);
      sections.push({
        title: `${key} — falhou ao rodar a checagem`,
        ok: false,
        summary: "erro ao executar, ver detalhe",
        details: String(e),
      });
    }
  }

  await sendEmail(sections);

  return new Response(
    JSON.stringify({ ok: true, sections, errors, run_at: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
