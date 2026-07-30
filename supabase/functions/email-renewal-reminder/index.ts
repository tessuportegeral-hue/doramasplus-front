import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const PLANS_LINK = "https://doramasplus.com.br/plans";
const SUPORTE_LINK = "https://wa.me/5518996796654";
const COMUNIDADE_LINK = "https://chat.whatsapp.com/Kp6dQuElfhrHWeuv1qUwtR";

const TZ = "America/Sao_Paulo";

// Planos que usam a variante "Passe Teste" do aviso do dia
const TRIAL_PLAN_NAMES = ["DoramasPlus Passe Teste"];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type ReminderKind = "renew_3d" | "renew_1d" | "renew_1d_trial" | "return_7d" | "stripe_failed_3d";

function getSaoPauloDateParts(base: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const year = parts.find((p) => p.type === "year")?.value || "1970";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return { year, month, day };
}

// Meia-noite em Brasilia = 03:00 UTC
function startOfDaySaoPauloUTC(base: Date): Date {
  const { year, month, day } = getSaoPauloDateParts(base);
  return new Date(`${year}-${month}-${day}T03:00:00.000Z`);
}

function endOfDaySaoPauloUTC(base: Date): Date {
  return new Date(startOfDaySaoPauloUTC(base).getTime() + 24 * 60 * 60 * 1000 - 1);
}

async function alreadySent(userId: string, kind: ReminderKind): Promise<boolean> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from("whatsapp_renewal_logs").select("id").eq("kind", `email_${kind}`).eq("user_id", userId).gte("created_at", since).limit(1);
  return (data?.length || 0) > 0;
}

// ✅ 30/07: volta a mandar todo mundo pro /plans em vez de pré-gerar um
// checkout — pelo /plans a pessoa gera o Pix copia-e-cola direto ali,
// mais fácil que cair numa página hospedada externa (Asaas/InfinityPay).
async function resolveRenewalLink(): Promise<string> {
  return PLANS_LINK;
}

function buildHtml(name: string, kind: ReminderKind, link: string): string {
  const messages: Record<ReminderKind, { subject: string; headline: string; body: string; cta: string }> = {
    renew_3d: {
      subject: "Seu acesso ao DoramasPlus vence em 3 dias 💜",
      headline: "Seu acesso vence em 3 dias!",
      body: `Oi, <strong>${name}</strong>! 👋<br><br>Só um aviso: seu acesso ao DoramasPlus vence em <strong>3 dias</strong>. Para continuar assistindo seus doramas favoritos sem interrupção, renove agora mesmo! Por apenas <strong>R$16,90/mês</strong>.`,
      cta: "Renovar meu acesso",
    },
    renew_1d: {
      subject: "Seu acesso ao DoramasPlus vence HOJE ⚠️",
      headline: "Seu acesso vence hoje!",
      body: `Oi, <strong>${name}</strong>! 😰<br><br>Hoje seu acesso ao DoramasPlus expira. Não perca seus doramas — renove agora por apenas <strong>R$16,90</strong> e continue de onde parou!`,
      cta: "Renovar agora antes que expire",
    },
    renew_1d_trial: {
      subject: "Seu acesso teste ao DoramasPlus vence HOJE ⏰",
      headline: "Renovação Urgente — Aviso Hoje!",
      body: `Oi, <strong>${name}</strong>! 😱<br><br>Seu passe de teste do DoramasPlus vence <strong>hoje</strong>! Gostou do que viu? Vire assinante agora e continue maratonando seus doramas favoritos sem parar, por apenas <strong>R$16,90/mês</strong>.`,
      cta: "Quero continuar assistindo",
    },
    return_7d: {
      subject: "Sentimos sua falta no DoramasPlus 🥺",
      headline: "A gente sentiu sua falta...",
      body: `Oi, <strong>${name}</strong>! 💜<br><br>Faz 7 dias que seu acesso ao DoramasPlus expirou e a gente sentiu sua falta. Tem muita coisa nova esperando por você! Renove por apenas <strong>R$16,90/mês</strong>.`,
      cta: "Voltar ao DoramasPlus",
    },
    stripe_failed_3d: {
      subject: "Não conseguimos renovar seu acesso ao DoramasPlus 😕",
      headline: "Seu acesso expirou",
      body: `Oi, <strong>${name}</strong>! 👋<br><br>Tentamos renovar seu acesso automaticamente mas não conseguimos completar a cobrança no seu cartão.<br><br>Isso pode acontecer por falta de saldo, cartão vencido ou bloqueio do banco. Sem problemas — você pode reativar agora mesmo pagando por PIX ou outro cartão, por apenas <strong>R$16,90/mês</strong>!`,
      cta: "Reativar meu acesso",
    },
  };
  const m = messages[kind];
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">DoramasPlus 💜</h1>
<p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">${m.headline}</p>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.7;">${m.body}</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;"><tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);border-radius:10px;">
<a href="${link}" style="display:inline-block;padding:14px 36px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">${m.cta} →</a>
</td></tr></table>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;">Dúvidas? Fale com a gente pelo WhatsApp: <a href="${SUPORTE_LINK}" style="color:#a855f7;">(18) 99679-6654</a></p>
<p style="margin:0;color:#64748b;font-size:13px;">Entre na nossa comunidade: <a href="${COMUNIDADE_LINK}" style="color:#a855f7;">clique aqui</a></p>
</td></tr>
<tr><td style="background:#111827;padding:20px 40px;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus &middot; Você está recebendo este email por ser assinante da plataforma.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(to: string, name: string, kind: ReminderKind, link: string): Promise<void> {
  const subjects: Record<ReminderKind, string> = {
    renew_3d: "Seu acesso ao DoramasPlus vence em 3 dias 💜",
    renew_1d: "Seu acesso ao DoramasPlus vence HOJE ⚠️",
    renew_1d_trial: "Seu acesso teste ao DoramasPlus vence HOJE ⏰",
    return_7d: "Sentimos sua falta no DoramasPlus 🥺",
    stripe_failed_3d: "Não conseguimos renovar seu acesso ao DoramasPlus 😕",
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: subjects[kind], html: buildHtml(name, kind, link) }),
  });
  if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(`Resend error ${res.status}: ${txt}`); }
}

async function processGroup(kind: ReminderKind, subscriptions: any[]): Promise<{ sent: number; skipped: number }> {
  let sent = 0, skipped = 0;
  for (const sub of subscriptions) {
    // renew_1d: assinaturas do Passe Teste usam a variante "trial" do aviso do dia
    const effectiveKind: ReminderKind =
      kind === "renew_1d" && sub.plan_name && TRIAL_PLAN_NAMES.includes(sub.plan_name)
        ? "renew_1d_trial"
        : kind;

    const already = await alreadySent(sub.user_id, effectiveKind);
    if (already) { skipped++; continue; }
    const { data: profile } = await supabase.from("profiles").select("name, email").eq("id", sub.user_id).maybeSingle();
    const email = profile?.email;
    if (!email || email.endsWith("@doramasplus.com")) { skipped++; continue; }
    const name = String(profile?.name || "").split(" ")[0] || "você";
    const link = kind === "stripe_failed_3d" ? PLANS_LINK : await resolveRenewalLink();
    try {
      await sendEmail(email, name, effectiveKind, link);
      await supabase.from("whatsapp_renewal_logs").insert({ user_id: sub.user_id, kind: `email_${effectiveKind}`, provider: "resend", sent_to: email, template_name: `email_${effectiveKind}`, meta: { subscription_id: sub.id, end_at: sub.end_at, plan_name: sub.plan_name ?? null, link } });
      sent++;
    } catch (e) { console.error(`erro ${effectiveKind} para ${email}:`, String(e)); skipped++; }
  }
  return { sent, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  try {
    const now = new Date();

    // renew_3d: continua olhando 3 dias a frente (janela do dia, em Brasilia)
    const in3d_base = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in3d_start = startOfDaySaoPauloUTC(in3d_base);
    const in3d_end = endOfDaySaoPauloUTC(in3d_base);
    const { data: subs3d } = await supabase.from("subscriptions").select("id, user_id, end_at, plan_name, provider").eq("status", "active").is("stripe_subscription_id", null).gte("end_at", in3d_start.toISOString()).lte("end_at", in3d_end.toISOString());

    // renew_1d: agora dispara no DIA do vencimento (janela de hoje, em Brasilia) em vez de "amanha"
    const today_start = startOfDaySaoPauloUTC(now);
    const today_end = endOfDaySaoPauloUTC(now);
    const { data: subs1d } = await supabase.from("subscriptions").select("id, user_id, end_at, plan_name, provider").eq("status", "active").is("stripe_subscription_id", null).gte("end_at", today_start.toISOString()).lte("end_at", today_end.toISOString());

    // return_7d: 7 dias apos o vencimento (janela do dia, em Brasilia)
    const exp7d_base = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const exp7d_start = startOfDaySaoPauloUTC(exp7d_base);
    const exp7d_end = endOfDaySaoPauloUTC(exp7d_base);
    const { data: subs7d } = await supabase.from("subscriptions").select("id, user_id, end_at, plan_name, provider").neq("status", "active").is("stripe_subscription_id", null).gte("end_at", exp7d_start.toISOString()).lte("end_at", exp7d_end.toISOString());

    // stripe_failed_3d: 3 dias apos falha (janela do dia, em Brasilia)
    const stripeExp3d_base = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const stripeExp3d_start = startOfDaySaoPauloUTC(stripeExp3d_base);
    const stripeExp3d_end = endOfDaySaoPauloUTC(stripeExp3d_base);
    const { data: stripeFailed3d } = await supabase.from("subscriptions").select("id, user_id, end_at, plan_name, provider").neq("status", "active").not("stripe_subscription_id", "is", null).gte("end_at", stripeExp3d_start.toISOString()).lte("end_at", stripeExp3d_end.toISOString());

    const results = {
      renew_3d: await processGroup("renew_3d", subs3d || []),
      renew_1d: await processGroup("renew_1d", subs1d || []),
      return_7d: await processGroup("return_7d", subs7d || []),
      stripe_failed_3d: await processGroup("stripe_failed_3d", stripeFailed3d || []),
    };
    return new Response(JSON.stringify({ ok: true, timezone: TZ, results }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 });
  }
});
