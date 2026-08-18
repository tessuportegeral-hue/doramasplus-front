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

async function alreadySentToUserLast48h(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from("whatsapp_renewal_logs").select("id").eq("kind", "abandoned_checkout_email").eq("user_id", userId).gte("created_at", since).limit(1);
  return (data?.length || 0) > 0;
}

async function sendEmail(to: string, name: string, plan: string): Promise<void> {
  const planLabel = plan === "quarterly" ? "Trimestral" : "Mensal";
  const price = plan === "quarterly" ? "R$49,90" : "R$17,90";

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">DoramasPlus 💜</h1>
<p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">Seu acesso está esperando por você</p>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 16px;color:#e2e8f0;font-size:16px;">Oi, <strong>${name}</strong>! 👋</p>
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.6;">Você gerou um PIX para o plano <strong style="color:#a855f7;">${planLabel} (${price})</strong>, mas não identificamos o pagamento ainda.</p>
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.6;">Se quiser ativar seu acesso a milhares de doramas dublados em português, é só gerar um novo PIX — leva menos de 1 minuto! 🎬</p>
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
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus · Você está recebendo este email porque iniciou um pagamento em nossa plataforma.</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: "Seu acesso ao DoramasPlus está esperando 💜", html }),
  });
  if (!res.ok) { const txt = await res.text().catch(() => ""); throw new Error(`Resend error ${res.status}: ${txt}`); }
}

Deno.serve(async (req) => {
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  try {
    const { data: pendingPixs, error } = await supabase.from("pix_payments").select("id, user_id, plan, created_at").eq("status", "pending").not("user_id", "is", null).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).lte("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString()).order("created_at", { ascending: true }).limit(200);
    if (error) throw error;
    if (!pendingPixs?.length) return new Response(JSON.stringify({ ok: true, sent: 0, message: "no pending checkouts" }), { status: 200 });
    const seenUsers = new Set<string>();
    const deduplicated = pendingPixs.filter(p => { if (seenUsers.has(p.user_id)) return false; seenUsers.add(p.user_id); return true; });
    let sent = 0, skipped = 0;
    for (const pix of deduplicated) {
      const alreadySent = await alreadySentToUserLast48h(pix.user_id);
      if (alreadySent) { skipped++; continue; }
      const { data: profile } = await supabase.from("profiles").select("name, email").eq("id", pix.user_id).maybeSingle();
      const email = profile?.email;
      if (!email || email.endsWith("@doramasplus.com")) { skipped++; continue; }
      const name = String(profile?.name || "").split(" ")[0] || "você";
      try {
        await sendEmail(email, name, pix.plan || "monthly");
        await supabase.from("whatsapp_renewal_logs").insert({ user_id: pix.user_id, kind: "abandoned_checkout_email", provider: "resend", sent_to: email, template_name: "abandoned_checkout_email", meta: { pix_id: pix.id, reason: "sent" } });
        sent++;
      } catch (e) { console.error(`erro ao enviar para ${email}:`, String(e)); skipped++; }
    }
    return new Response(JSON.stringify({ ok: true, sent, skipped, total: pendingPixs.length, deduplicated: deduplicated.length }), { status: 200 });
  } catch (e) { return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 }); }
});
