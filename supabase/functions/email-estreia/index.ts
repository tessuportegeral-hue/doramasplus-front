import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ✅ 20/08 — E-MAIL DE ESTREIA (pedido do Stefano): assinante ATIVO que
// pagou há 2+ dias e NUNCA deu play em nada. Era o único grupo do card
// "em risco" do Pulso sem cobertura nenhuma (61 pessoas no lançamento) —
// o churn mais certo e mais evitável: pagou e não estreou.
// Regras (mesmo padrão das escadas reengagement/winback):
// - elegibilidade em UMA query agregada no banco (exec_sql — nunca .in()
//   gigante, ver bug que matou o reengagement por 2 meses)
// - claim-first em whatsapp_renewal_logs (kind 'estreia') ANTES do envio;
//   1 e-mail POR VIDA por usuário (se nunca estreou de novo, já recebeu)
// - corpo com os 3 doramas mais assistidos dos últimos 14 dias (dinâmico)
// - body {test_email} manda UM exemplo pro e-mail dado, sem claim.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const SUPORTE_LINK = "https://wa.me/5518996796654";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";
const BATCH = 120;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function buildHtml(name: string, tops: { title: string; slug: string }[]): string {
  const utm = "utm_source=email&utm_medium=email&utm_campaign=estreia";
  const lista = tops
    .map(
      (t, i) => `
<tr><td style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">
  <a href="https://doramasplus.com.br/dorama/${t.slug}?${utm}" style="color:#e9d5ff;font-size:15px;font-weight:700;text-decoration:none;">${i + 1}. ${t.title} →</a>
</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:26px;font-weight:800;">Seu acesso está liberado 💜</h1>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 20px;color:#cbd5e1;font-size:15px;line-height:1.8;">
Oi, <strong>${name}</strong>! 👋<br><br>
Sua assinatura está ativa, mas a gente viu que você <strong>ainda não assistiu nenhum dorama</strong> — e não queremos que você pague sem aproveitar!<br><br>
Pra facilitar, separamos os <strong>3 mais assistidos da semana</strong>. Escolhe um e dá o play — em 5 minutos você já vai estar viciado(a) 😄
</p>
<table cellpadding="0" cellspacing="0" style="width:100%;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.3);border-radius:12px;margin:0 0 24px;">${lista}</table>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);border-radius:10px;">
<a href="https://doramasplus.com.br/dashboard?${utm}" style="display:inline-block;padding:14px 36px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">Ver o catálogo completo →</a>
</td></tr></table>
<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;"><tr><td style="background:rgba(168,85,247,0.14);border:1px solid rgba(168,85,247,0.4);border-radius:12px;padding:16px 18px;text-align:center;">
<p style="margin:0 0 6px;color:#f3e8ff;font-size:16px;font-weight:800;">📱 Melhor ainda no app oficial!</p>
<a href="${PLAY_STORE_URL}" style="color:#c084fc;font-size:15px;font-weight:700;text-decoration:underline;">Baixar grátis na Google Play →</a>
</td></tr></table>
<p style="margin:0;color:#64748b;font-size:13px;">Alguma dificuldade pra assistir? Fala com a gente no WhatsApp: <a href="${SUPORTE_LINK}" style="color:#a855f7;">(18) 99679-6654</a> — resolvemos na hora.</p>
</td></tr>
<tr><td style="background:#111827;padding:20px 40px;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(to: string, html: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject: "Você assinou e ainda não assistiu nada! Começa por esses 👇",
      html,
    }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  try {
    const body = await req.json().catch(() => ({}));

    // 3 doramas mais assistidos dos últimos 14 dias (por pessoas distintas)
    const { data: topsRaw, error: topErr } = await supabase.rpc("exec_sql", {
      q: `
      select d.title, d.slug
      from doramas d
      join (select dorama_id, count(distinct user_id) c from watch_history
            where updated_at > now() - interval '14 days' group by 1 order by 2 desc limit 3) w
        on w.dorama_id = d.id
      order by w.c desc
    ` });
    if (topErr) throw new Error("tops: " + topErr.message);
    const tops = (topsRaw || []) as { title: string; slug: string }[];
    if (!tops.length) throw new Error("sem doramas pro corpo do e-mail");

    // modo teste: manda 1 exemplo e sai (sem claim, sem tocar em ninguém)
    if (body?.test_email) {
      const ok = await sendEmail(String(body.test_email), buildHtml("Stefano", tops));
      return new Response(JSON.stringify({ ok, test: true, to: body.test_email }), { status: 200 });
    }

    // elegíveis: ativo + 1º pagamento há 2+ dias + NUNCA assistiu + e-mail
    // válido + nunca recebeu 'estreia' (1x por vida)
    const { data: rows, error: eligErr } = await supabase.rpc("exec_sql", {
      q: `
      with ativos as (
        select s.user_id from subscriptions s
        where s.status in ('active','trialing','paid')
          and ((coalesce(s.end_at, s.current_period_end) is null and s.provider is null)
               or coalesce(s.end_at, s.current_period_end) > now())
      ),
      firsts as (select user_id, min(renewed_at) f from subscription_renewals group by 1)
      select a.user_id, p.email, coalesce(p.name, '') as name
      from ativos a
      join firsts fi on fi.user_id = a.user_id and fi.f < now() - interval '2 days'
      join profiles p on p.id = a.user_id
      where p.email is not null and p.email not like '%@doramasplus%'
        and not exists (select 1 from watch_history w where w.user_id = a.user_id)
        and not exists (select 1 from whatsapp_renewal_logs l where l.user_id = a.user_id and l.kind = 'estreia')
      limit ${BATCH}
    ` });
    if (eligErr) throw new Error("elegiveis: " + eligErr.message);

    let sent = 0, skipped = 0;
    for (const r of (rows || []) as any[]) {
      const name = String(r.name || "").split(" ")[0] || "você";
      // claim-first: reserva ANTES de enviar (unique user_id+day fecha corrida)
      const { data: claimed, error: claimErr } = await supabase
        .from("whatsapp_renewal_logs")
        .insert({ user_id: r.user_id, kind: "estreia", provider: "resend", sent_to: r.email, template_name: "estreia" })
        .select("id")
        .single();
      if (claimErr) { skipped++; continue; }
      try {
        const ok = await sendEmail(r.email, buildHtml(name, tops));
        if (!ok) {
          await supabase.from("whatsapp_renewal_logs").delete().eq("id", claimed.id);
          skipped++;
          continue;
        }
        sent++;
      } catch {
        await supabase.from("whatsapp_renewal_logs").delete().eq("id", claimed.id);
        skipped++;
      }
    }
    return new Response(JSON.stringify({ ok: true, sent, skipped }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 });
  }
});
