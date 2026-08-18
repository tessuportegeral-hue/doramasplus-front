import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const PLANS_LINK = "https://doramasplus.com.br/plans";
const SUPORTE_LINK = "https://wa.me/5518996796654";
const COMUNIDADE_LINK = "https://chat.whatsapp.com/Kp6dQuElfhrHWeuv1qUwtR";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  try {
    const from = new Date(Date.now() - 8 * 60 * 1000).toISOString();
    const to = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: newUsers } = await supabase.from("profiles").select("id, name, email").gte("created_at", from).lte("created_at", to).not("email", "ilike", "%@doramasplus%");
    if (!newUsers?.length) return new Response(JSON.stringify({ ok: true, sent: 0, message: "no new users" }), { status: 200 });
    const { data: pixUsers } = await supabase.from("pix_payments").select("user_id").in("user_id", newUsers.map(u => u.id));
    const { data: subUsers } = await supabase.from("subscriptions").select("user_id").eq("status", "active").in("user_id", newUsers.map(u => u.id));
    const excludeSet = new Set([...(pixUsers || []).map((r: any) => r.user_id), ...(subUsers || []).map((r: any) => r.user_id)]);
    const { data: alreadySent } = await supabase.from("whatsapp_renewal_logs").select("user_id").eq("kind", "email_new_signup").in("user_id", newUsers.map(u => u.id));
    const sentSet = new Set((alreadySent || []).map((r: any) => r.user_id));
    const eligible = newUsers.filter(u => !excludeSet.has(u.id) && !sentSet.has(u.id));
    let sent = 0, skipped = 0;
    for (const user of eligible) {
      const email = user.email;
      if (!email) { skipped++; continue; }
      const name = String(user.name || "").split(" ")[0] || "você";
      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">DoramasPlus 💜</h1>
<p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">Seu cadastro foi criado com sucesso!</p>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.8;">
Oi, <strong>${name}</strong>! 👋<br><br>
Que bom te ver por aqui! Seu cadastro na DoramasPlus foi criado com sucesso.<br><br>
Agora é só ativar seu acesso pra começar a assistir milhares de doramas coreanos e asiáticos dublados em português, com qualidade HD e sem anúncios. 🎬<br><br>
Por apenas <strong>R$17,90/mês</strong> você desbloqueia tudo isso agora!
</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;"><tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);border-radius:10px;">
<a href="${PLANS_LINK}" style="display:inline-block;padding:14px 36px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">Ativar meu acesso agora →</a>
</td></tr></table>
<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;"><tr><td style="background:rgba(168,85,247,0.14);border:1px solid rgba(168,85,247,0.4);border-radius:12px;padding:16px 18px;text-align:center;">
<p style="margin:0 0 6px;color:#f3e8ff;font-size:16px;font-weight:800;">📱 Baixe o app oficial da DoramasPlus!</p>
<a href="${PLAY_STORE_URL}" style="color:#c084fc;font-size:15px;font-weight:700;text-decoration:underline;">Baixar agora na Google Play →</a>
</td></tr></table>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;">Dúvidas? Fale com a gente pelo WhatsApp: <a href="${SUPORTE_LINK}" style="color:#a855f7;">(18) 99679-6654</a></p>
<p style="margin:0;color:#64748b;font-size:13px;">Entre na nossa comunidade: <a href="${COMUNIDADE_LINK}" style="color:#a855f7;">clique aqui</a></p>
</td></tr>
<tr><td style="background:#111827;padding:20px 40px;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus &middot; Você recebe este email por ter se cadastrado em nossa plataforma.</p>
</td></tr>
</table></td></tr></table></body></html>`;
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: "Bem-vindo(a) ao DoramasPlus! Ative seu acesso 💜", html }),
        });
        if (!res.ok) { skipped++; continue; }
        await supabase.from("whatsapp_renewal_logs").insert({ user_id: user.id, kind: "email_new_signup", provider: "resend", sent_to: email, template_name: "email_new_signup", meta: { reason: "new_signup_3min" } });
        sent++;
      } catch { skipped++; }
    }
    return new Response(JSON.stringify({ ok: true, sent, skipped, total: eligible.length }), { status: 200 });
  } catch (e) { return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 }); }
});
