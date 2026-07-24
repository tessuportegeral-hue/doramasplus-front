import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const PLANS_LINK = "https://doramasplus.com.br/plans";
const SUPORTE_LINK = "https://wa.me/5518996796654";
const COMUNIDADE_LINK = "https://chat.whatsapp.com/Kp6dQuElfhrHWeuv1qUwtR";

const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || "https://doramasplus.com.br";
const INFINITEPAY_HANDLE = Deno.env.get("INFINITEPAY_HANDLE") || "";
const INFINITEPAY_WEBHOOK_URL =
  Deno.env.get("INFINITEPAY_WEBHOOK_URL") || Deno.env.get("INIFITEPAY_WEBHOOK_URL") || "";

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

// ✅ 23/07: mesma lógica do whatsapp-renewal-cron — gera checkout InfinityPay
// pronto + token curto (doramasplus.com.br/r/<token>) em vez de mandar pro
// /plans (que exige login e escolher o plano de novo). Só pra provider=infinitepay;
// qualquer falha cai no link antigo, nunca trava o envio do email.
async function createShortRedirect(targetUrl: string): Promise<string | null> {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const { error } = await supabase.from("payment_redirects").insert({ token, target_url: targetUrl });
  if (error) {
    console.error("[renewal-link] falha ao gravar payment_redirects:", String(error));
    return null;
  }
  return token;
}

function planFromName(planName: string | null | undefined): "monthly" | "quarterly" {
  return String(planName || "").toLowerCase().includes("trimestral") ? "quarterly" : "monthly";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ✅ 24/07: achado o motivo real (ver whatsapp-renewal-cron) — a InfinityPay
// libera só 5 chamadas de criação de checkout em sequência e bloqueia por
// ~40-50s depois. Pacer compartilhado via banco (tabela infinitepay_link_pacer)
// pra respeitar esse ritmo mesmo com whatsapp-renewal-cron chamando ao mesmo tempo.
async function claimInfinitepaySlot(): Promise<void> {
  const sql = `
    with cur as (
      select next_allowed_at from infinitepay_link_pacer where id = 1 for update
    ), calc as (
      select greatest(cur.next_allowed_at, now()) as my_slot from cur
    )
    update infinitepay_link_pacer
    set next_allowed_at = (select my_slot from calc) + interval '9 seconds'
    where id = 1
    returning (select my_slot from calc) as my_slot;
  `;
  try {
    const { data, error } = await supabase.rpc("exec_sql", { q: sql });
    if (error) return;
    const rows: Record<string, unknown>[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { rows?: Record<string, unknown>[] })?.rows)
      ? (data as { rows?: Record<string, unknown>[] }).rows!
      : [];
    const mySlot = rows?.[0]?.my_slot as string | undefined;
    if (!mySlot) return;
    const waitMs = new Date(mySlot).getTime() - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  } catch (e) {
    console.error("[renewal-link] falha no pacer da InfinityPay:", String(e));
  }
}

async function createInfinitepayCheckoutLinkAttempt(
  userId: string,
  plan: "monthly" | "quarterly"
): Promise<string | null> {
  const amountCents = plan === "quarterly" ? 4790 : 1690;
  const description = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrao";
  const order_nsu = `doramasplus|${userId}|${plan}|${Date.now()}`;
  const redirect_url =
    `${PUBLIC_BASE_URL}/checkout/sucesso` +
    `?gateway=infinitepay&order_nsu=${encodeURIComponent(order_nsu)}` +
    `&event_id=${encodeURIComponent(order_nsu)}`;

  const { data: prof } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  const userEmail = prof?.email || "no-email@local.invalid";

  const resp = await fetch("https://api.checkout.infinitepay.io/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: INFINITEPAY_HANDLE,
      order_nsu,
      webhook_url: INFINITEPAY_WEBHOOK_URL,
      redirect_url,
      items: [{ quantity: 1, price: amountCents, description }],
      customer: { email: userEmail },
    }),
  });

  const text = await resp.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}

  if (!resp.ok || !parsed?.url) {
    console.error("[renewal-link] falha ao gerar checkout InfinitePay:", resp.status, text.slice(0, 300));
    return null;
  }

  try {
    await supabase.from("pix_payments").insert({
      user_id: userId,
      provider: "infinitepay",
      plan,
      amount_cents: amountCents,
      order_nsu,
      status: "pending",
      raw: parsed,
      event_id: order_nsu,
      source: "email_renewal_reminder",
    });
  } catch (e) {
    console.error("[renewal-link] falha ao gravar pix_payments pending:", String(e));
  }

  return String(parsed.url);
}

async function createInfinitepayCheckoutLink(
  userId: string,
  plan: "monthly" | "quarterly"
): Promise<string | null> {
  if (!INFINITEPAY_HANDLE || !INFINITEPAY_WEBHOOK_URL) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    await claimInfinitepaySlot();
    try {
      const url = await createInfinitepayCheckoutLinkAttempt(userId, plan);
      if (url) return url;
    } catch (e) {
      console.error(`[renewal-link] excecao ao gerar checkout (tentativa ${attempt}):`, String(e));
    }
  }

  return null;
}

// ✅ 23/07: gera link direto pra qualquer provider que não seja Stripe
// (infinitepay, asaas, manual, comprovante_validado, etc).
async function resolveRenewalLink(
  userId: string,
  provider: string | null | undefined,
  planName: string | null | undefined
): Promise<string> {
  if (provider === "stripe") return PLANS_LINK;

  const plan = planFromName(planName);
  const checkoutUrl = await createInfinitepayCheckoutLink(userId, plan);
  if (!checkoutUrl) return PLANS_LINK;

  const token = await createShortRedirect(checkoutUrl);
  if (!token) return PLANS_LINK;

  return `${PUBLIC_BASE_URL}/r/${token}`;
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
    const link = kind === "stripe_failed_3d" ? PLANS_LINK : await resolveRenewalLink(sub.user_id, sub.provider, sub.plan_name);
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
