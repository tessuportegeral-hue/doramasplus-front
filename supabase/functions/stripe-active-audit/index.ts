// stripe-active-audit: roda 1x/dia via pg_cron. Confere toda assinatura Stripe
// que hoje conta como "ativa" no painel (subscriptions.provider IS NULL,
// status active/trialing/paid) contra o status real na Stripe. Se a Stripe
// diz canceled/past_due/unpaid/incomplete_expired mas o banco ainda diz ativo
// (ex.: webhook perdeu o evento de cancelamento), grava a divergência em
// stripe_active_audit_log. Não corrige nada sozinho — só detecta e loga,
// pra revisão manual (ver CLAUDE.md: nunca mexer em lógica de pagamento
// sem autorização).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "npm:stripe@14.19.0";
import { createClient } from "npm:@supabase/supabase-js@2.33.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") || "tessuportegeral@gmail.com";

// mesmo padrão de segredo hardcoded já usado no cron job da whatsapp-sales-bot
// (x-followup-secret) — a função é verify_jwt:false pra ser chamada pelo pg_cron.
const CRON_SECRET = "dp_stripe_audit_q7z1w9r";

const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2023-08-16" });
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const OK_STRIPE_STATUSES = new Set(["active", "trialing"]);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ✅ 31/07: antes essa auditoria só gravava em stripe_active_audit_log, sem
// nunca avisar ninguém — passa a mandar email TODO DIA (mesmo sem
// divergência), pro admin saber que rodou e não confundir "silêncio" com
// "travou". Mesmo padrão do asaas-integrity-check.
async function sendEmail(mismatchRows: any[], checked: number, checkFailures: number) {
  if (!RESEND_API_KEY || !ALERT_EMAIL) return;
  const hasIssues = mismatchRows.length > 0;
  const list = mismatchRows
    .map((r) => `• user_id ${r.user_id} — banco diz "${r.db_status}", Stripe diz "${r.stripe_status}" — sub ${r.stripe_subscription_id}`)
    .join("<br>");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: hasIssues
        ? `⚠️ Stripe: ${mismatchRows.length} assinatura(s) divergente(s) do painel`
        : `✅ Stripe: checagem diária ok, 0 divergências`,
      html: hasIssues
        ? `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
        <p>Checagem diária Stripe conferiu ${checked} assinatura(s) "ativa(s)" no banco contra o status real na Stripe e achou divergência(s) — provável webhook de cancelamento perdido.</p>
        <p>${list}</p>
        ${checkFailures ? `<p style="color:#c0392b">${checkFailures} verificação(ões) falharam ao consultar a Stripe.</p>` : ""}
        <p style="color:#888">Isso não corrige nada automaticamente. Detalhe completo em stripe_active_audit_log. Verificar manualmente antes de cortar acesso.</p>
      </div>`
        : `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
        <p>Checagem diária Stripe conferiu ${checked} assinatura(s) "ativa(s)" no banco contra a Stripe e não encontrou nenhuma divergência. Tudo certo. ✅</p>
      </div>`,
    }),
  }).catch((e) => console.error("[stripe-active-audit] email fail:", String(e)));
}

serve(async (req) => {
  try {
    if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("id, user_id, status, stripe_subscription_id")
      .is("provider", null)
      .in("status", ["active", "trialing", "paid"])
      .not("stripe_subscription_id", "is", null);

    if (error) {
      return new Response(JSON.stringify({ error: "query_failed", details: error }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = subs ?? [];
    const runAt = new Date().toISOString();
    const logRows: any[] = [];
    let mismatches = 0;
    let checkFailures = 0;

    for (const batch of chunk(rows, 10)) {
      await Promise.all(
        batch.map(async (sub) => {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
            const isMismatch = !OK_STRIPE_STATUSES.has(stripeSub.status);
            if (isMismatch) mismatches++;
            logRows.push({
              run_at: runAt,
              subscription_id: sub.id,
              user_id: sub.user_id,
              stripe_subscription_id: sub.stripe_subscription_id,
              db_status: sub.status,
              stripe_status: stripeSub.status,
              mismatch: isMismatch,
            });
          } catch (e: any) {
            checkFailures++;
            logRows.push({
              run_at: runAt,
              subscription_id: sub.id,
              user_id: sub.user_id,
              stripe_subscription_id: sub.stripe_subscription_id,
              db_status: sub.status,
              stripe_status: "check_failed",
              mismatch: true,
              detail: String(e?.message ?? e),
            });
          }
        })
      );
    }

    if (logRows.length > 0) {
      const { error: insertError } = await supabase
        .from("stripe_active_audit_log")
        .insert(logRows);
      if (insertError) {
        return new Response(
          JSON.stringify({ error: "insert_failed", details: insertError }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const mismatchRows = logRows.filter((r) => r.mismatch);
    await sendEmail(mismatchRows, rows.length, checkFailures);

    return new Response(
      JSON.stringify({
        ok: true,
        checked: rows.length,
        mismatches,
        check_failures: checkFailures,
        run_at: runAt,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", details: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
