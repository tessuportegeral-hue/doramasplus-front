import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const PLANS_LINK = "https://doramasplus.com.br/plans";
const APP_LINK = "https://doramasplus.com.br";
const SUPORTE_LINK = "https://wa.me/5518996796654";
const SUPORTE_TEL = "(18) 99679-6654";
const COMUNIDADE_LINK = "https://chat.whatsapp.com/Kp6dQuElfhrHWeuv1qUwtR";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function processWelcome() {
  const from = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const to   = new Date(Date.now() - 1  * 60 * 1000).toISOString();
  const { data: recentPix } = await supabase.from("pix_payments").select("user_id, plan, paid_at").eq("status", "paid").not("user_id", "is", null).gte("paid_at", from).lte("paid_at", to);
  if (!recentPix?.length) return { sent: 0, skipped: 0 };
  const seenMap = new Map<string, any>();
  for (const p of recentPix) { if (!seenMap.has(p.user_id)) seenMap.set(p.user_id, p); }
  const uniqueUsers = [...seenMap.values()];
  const userIds = uniqueUsers.map(u => u.user_id);
  const { data: alreadySent } = await supabase.from("whatsapp_renewal_logs").select("user_id").eq("kind", "email_welcome").in("user_id", userIds);
  const sentSet = new Set((alreadySent || []).map((r: any) => r.user_id));
  const eligible = uniqueUsers.filter(u => !sentSet.has(u.user_id));
  if (!eligible.length) return { sent: 0, skipped: 0 };
  const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", eligible.map(u => u.user_id));
  let sent = 0, skipped = 0;
  for (const pix of eligible) {
    const profile = (profiles || []).find((p: any) => p.id === pix.user_id);
    const email = profile?.email;
    if (!email || email.includes("@doramasplus")) { skipped++; continue; }
    const name = String(profile?.name || "").split(" ")[0] || "você";
    const planLabel = pix.plan === "quarterly" ? "Trimestral" : "Mensal";
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">DoramasPlus 💜</h1>
<p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">Bem-vindo(a) ao mundo dos doramas!</p>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.8;">
Oi, <strong>${name}</strong>! 🎉<br><br>
Seu acesso ao DoramasPlus <strong>${planLabel}</strong> foi ativado com sucesso!<br><br>
Agora você tem acesso a milhares de doramas dublados em português, com qualidade HD e sem anúncios. 🎬<br><br>
Clica no botão abaixo e começa a assistir agora mesmo!
</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;"><tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);border-radius:10px;">
<a href="${APP_LINK}" style="display:inline-block;padding:14px 36px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">Assistir agora →</a>
</td></tr></table>
<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;"><tr><td style="background:rgba(168,85,247,0.14);border:1px solid rgba(168,85,247,0.4);border-radius:12px;padding:16px 18px;text-align:center;">
<p style="margin:0 0 6px;color:#f3e8ff;font-size:16px;font-weight:800;">📱 Baixe o app oficial da DoramasPlus!</p>
<a href="${PLAY_STORE_URL}" style="color:#c084fc;font-size:15px;font-weight:700;text-decoration:underline;">Baixar agora na Google Play →</a>
</td></tr></table>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;">Dúvidas? Fale com a gente pelo WhatsApp: <a href="${SUPORTE_LINK}" style="color:#a855f7;">${SUPORTE_TEL}</a></p>
<p style="margin:0;color:#64748b;font-size:13px;">Entre na nossa comunidade: <a href="${COMUNIDADE_LINK}" style="color:#a855f7;">clique aqui</a></p>
</td></tr>
<tr><td style="background:#111827;padding:20px 40px;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus &middot; Obrigado por assinar!</p>
</td></tr>
</table></td></tr></table></body></html>`;
    try {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` }, body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: "Seu acesso ao DoramasPlus está ativo! 🎉", html }) });
      if (!res.ok) { skipped++; continue; }
      await supabase.from("whatsapp_renewal_logs").insert({ user_id: pix.user_id, kind: "email_welcome", provider: "resend", sent_to: email, template_name: "email_welcome", meta: { plan: pix.plan } });
      sent++;
    } catch { skipped++; }
  }
  return { sent, skipped };
}

type FollowupConfig = { subject: string; headline: string; body: (name: string) => string; cta: string; windowStart: number; windowEnd: number; };

const followupConfigs: Record<"email_signup_24h" | "email_signup_7d" | "email_return_30d", FollowupConfig> = {
  email_signup_24h: {
    subject: "Você ainda não ativou seu acesso ao DoramasPlus 💜",
    headline: "Ainda dá tempo!",
    body: (name) => `Oi, <strong>${name}</strong>! 👋<br><br>Ontem você criou sua conta na DoramasPlus mas ainda não ativou seu acesso.<br><br>Aqui tem milhares de doramas dublados em português, qualidade HD, sem anúncios. 🎬<br><br>Por apenas <strong>R$17,90/mês</strong> você começa a assistir agora!`,
    cta: "Ativar meu acesso",
    windowStart: 23 * 60 * 60 * 1000, windowEnd: 25 * 60 * 60 * 1000,
  },
  email_signup_7d: {
    subject: "Uma semana e você ainda não conheceu o DoramasPlus 🎬",
    headline: "O que está te impedindo?",
    body: (name) => `Oi, <strong>${name}</strong>! 👋<br><br>Faz uma semana que você criou sua conta na DoramasPlus e a gente ficou na dúvida...<br><br>Por apenas <strong>R$17,90/mês</strong> você tem acesso a milhares de doramas dublados em português. 💜<br><br>Cancela quando quiser, sem fidelidade!`,
    cta: "Quero conhecer o DoramasPlus",
    windowStart: 6 * 24 * 60 * 60 * 1000, windowEnd: 8 * 24 * 60 * 60 * 1000,
  },
  email_return_30d: {
    subject: "30 dias sem doramas... a gente sentiu sua falta 🥺",
    headline: "30 dias sem você por aqui!",
    body: (name) => `Oi, <strong>${name}</strong>! 💜<br><br>Faz 30 dias que seu acesso ao DoramasPlus expirou e a gente sentiu muito sua falta.<br><br>Seu histórico ainda está salvo te esperando, e chegaram muitos doramas novos! 🎬<br><br>Volta por apenas <strong>R$17,90</strong> e continue de onde parou!`,
    cta: "Voltar ao DoramasPlus",
    windowStart: 29 * 24 * 60 * 60 * 1000, windowEnd: 31 * 24 * 60 * 60 * 1000,
  },
};

async function processFollowup(kind: "email_signup_24h" | "email_signup_7d" | "email_return_30d") {
  const config = followupConfigs[kind];
  const now = Date.now();
  const from = new Date(now - config.windowEnd).toISOString();
  const to   = new Date(now - config.windowStart).toISOString();
  let userIds: string[] = [];
  if (kind === "email_return_30d") {
    const { data: subs } = await supabase.from("subscriptions").select("user_id").neq("status", "active").gte("end_at", from).lte("end_at", to);
    const { data: active } = await supabase.from("subscriptions").select("user_id").eq("status", "active");
    const activeSet = new Set((active || []).map((r: any) => r.user_id));
    userIds = [...new Set((subs || []).map((r: any) => r.user_id))].filter(id => !activeSet.has(id));
  } else {
    const { data: profiles } = await supabase.from("profiles").select("id").gte("created_at", from).lte("created_at", to).not("email", "ilike", "%@doramasplus%");
    const ids = (profiles || []).map((r: any) => r.id);
    if (!ids.length) return { sent: 0, skipped: 0 };
    const { data: pixUsers } = await supabase.from("pix_payments").select("user_id").in("user_id", ids);
    const { data: subUsers } = await supabase.from("subscriptions").select("user_id").in("user_id", ids);
    const excludeSet = new Set([...(pixUsers || []).map((r: any) => r.user_id), ...(subUsers || []).map((r: any) => r.user_id)]);
    userIds = ids.filter((id: string) => !excludeSet.has(id));
  }
  if (!userIds.length) return { sent: 0, skipped: 0 };
  const { data: alreadySent } = await supabase.from("whatsapp_renewal_logs").select("user_id").eq("kind", kind).in("user_id", userIds);
  const sentSet = new Set((alreadySent || []).map((r: any) => r.user_id));
  const eligible = userIds.filter(id => !sentSet.has(id));
  if (!eligible.length) return { sent: 0, skipped: 0 };
  const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", eligible);
  let sent = 0, skipped = 0;
  for (const profile of (profiles || [])) {
    const email = profile.email;
    if (!email || email.includes("@doramasplus")) { skipped++; continue; }
    const name = String(profile.name || "").split(" ")[0] || "você";
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">DoramasPlus 💜</h1>
<p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">${config.headline}</p>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.8;">${config.body(name)}</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;"><tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);border-radius:10px;">
<a href="${PLANS_LINK}" style="display:inline-block;padding:14px 36px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">${config.cta} →</a>
</td></tr></table>
<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;"><tr><td style="background:rgba(168,85,247,0.14);border:1px solid rgba(168,85,247,0.4);border-radius:12px;padding:16px 18px;text-align:center;">
<p style="margin:0 0 6px;color:#f3e8ff;font-size:16px;font-weight:800;">📱 Baixe o app oficial da DoramasPlus!</p>
<a href="${PLAY_STORE_URL}" style="color:#c084fc;font-size:15px;font-weight:700;text-decoration:underline;">Baixar agora na Google Play →</a>
</td></tr></table>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;">Dúvidas? Fale com a gente pelo WhatsApp: <a href="${SUPORTE_LINK}" style="color:#a855f7;">${SUPORTE_TEL}</a></p>
<p style="margin:0;color:#64748b;font-size:13px;">Entre na nossa comunidade: <a href="${COMUNIDADE_LINK}" style="color:#a855f7;">clique aqui</a></p>
</td></tr>
<tr><td style="background:#111827;padding:20px 40px;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus &middot; Você recebe este email por ter se cadastrado em nossa plataforma.</p>
</td></tr>
</table></td></tr></table></body></html>`;
    try {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` }, body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: config.subject, html }) });
      if (!res.ok) { skipped++; continue; }
      await supabase.from("whatsapp_renewal_logs").insert({ user_id: profile.id, kind, provider: "resend", sent_to: email, template_name: kind, meta: { kind } });
      sent++;
    } catch { skipped++; }
  }
  return { sent, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  try {
    const welcome = await processWelcome();
    const r24h    = await processFollowup("email_signup_24h");
    const r7d     = await processFollowup("email_signup_7d");
    const r30d    = await processFollowup("email_return_30d");
    return new Response(JSON.stringify({ ok: true, email_welcome: welcome, email_signup_24h: r24h, email_signup_7d: r7d, email_return_30d: r30d }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 });
  }
});
