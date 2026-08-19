import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = "\"DoramasPlus\" <noreply@doramasplus.com.br>";
const PLANS_LINK = "https://doramasplus.com.br/plans";
const SUPORTE_LINK = "https://wa.me/5518996796654";
const COMUNIDADE_LINK = "https://chat.whatsapp.com/Kp6dQuElfhrHWeuv1qUwtR";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";
const BATCH_SIZE = 100;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const subjects: Record<string, string> = {
  g1: "Você deixou seu acesso ao DoramasPlus pra trás 💜",
  g2: "Sentimos sua falta no DoramasPlus 🥺",
  g3: "Você ainda não ativou seu acesso ao DoramasPlus 💜",
  g4: "Lembra de nós? Tem muita coisa nova no DoramasPlus! 🎬",
  g5: "Uma mensagem especial pra você do DoramasPlus 💜",
};

function buildHtml(name: string, group: string): string {
  const bodies: Record<string, string> = {
    g1: `Oi, <strong>${name}</strong>! 👋<br><br>Você chegou até o final — gerou o PIX, quase assinou — mas o acesso ficou pra trás.<br><br>Na DoramasPlus você tem acesso a milhares de doramas dublados em português, sem anúncio, sem trava. 🎬<br><br>Que tal ativar agora? Leva menos de 1 minuto!`,
    g2: `Oi, <strong>${name}</strong>! 💜<br><br>Faz um tempinho que você não aparece por aqui, e a gente sentiu sua falta.<br><br>Seu histórico ainda está salvo te esperando. Chegaram vários títulos novos! 🎬<br><br>Volta pra continuar de onde parou?`,
    g3: `Oi, <strong>${name}</strong>! 👋<br><br>Você se cadastrou na DoramasPlus mas ainda não ativou seu acesso.<br><br>Milhares de doramas dublados em português, HD, sem anúncios. 🎬<br><br>Por apenas <strong>R$17,90/mês</strong>!`,
    g4: `Oi, <strong>${name}</strong>! 👋<br><br>Você se cadastrou há um tempo mas ainda não conheceu a plataforma.<br><br>Dezenas de doramas novos chegaram! 🎬<br><br>Por apenas <strong>R$17,90/mês</strong> você desbloqueia tudo hoje!`,
    g5: `Oi, <strong>${name}</strong>! 👋<br><br>Você se cadastrou na DoramasPlus e a gente quer te ver por aqui.<br><br>Maior plataforma de doramas do Brasil, dublados em português, HD, sem anúncios. 🎬<br><br>Por apenas <strong>R$17,90/mês</strong>!`,
  };
  const ctas: Record<string, string> = {
    g1: "Ativar meu acesso agora", g2: "Voltar ao DoramasPlus",
    g3: "Ativar meu acesso", g4: "Ver os doramas novos", g5: "Quero assistir doramas",
  };
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">DoramasPlus 💜</h1>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.8;">${bodies[group] || bodies.g5}</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);border-radius:10px;">
<a href="${PLANS_LINK}?utm_source=email&utm_medium=email&utm_campaign=mass_${group}" style="display:inline-block;padding:14px 36px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">${ctas[group] || ctas.g5} →</a>
</td></tr></table>
<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;"><tr><td style="background:rgba(168,85,247,0.14);border:1px solid rgba(168,85,247,0.4);border-radius:12px;padding:16px 18px;text-align:center;">
<p style="margin:0 0 6px;color:#f3e8ff;font-size:16px;font-weight:800;">📱 Baixe o app oficial da DoramasPlus!</p>
<a href="${PLAY_STORE_URL}" style="color:#c084fc;font-size:15px;font-weight:700;text-decoration:underline;">Baixar agora na Google Play →</a>
</td></tr></table>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;">Dúvidas? Fale com a gente pelo WhatsApp: <a href="${SUPORTE_LINK}" style="color:#a855f7;">(18) 99679-6654</a></p>
<p style="margin:0;color:#64748b;font-size:13px;">Entre na nossa comunidade: <a href="${COMUNIDADE_LINK}" style="color:#a855f7;">clique aqui</a></p>
</td></tr>
<tr><td style="background:#111827;padding:20px 40px;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  try {
    const body = await req.json().catch(() => ({}));
    const group: string = body.group || "g1";

    // Cota diaria atomica (3.000/dia pra TODAS as campanhas somadas, trava por
    // linha no banco -- mesmo com os 5 crons disparando quase juntos, a soma
    // nunca ultrapassa o teto). Se ja bateu o teto hoje, nem busca gente.
    // ✅ 19/08: a sobra da reserva é DEVOLVIDA no fim da rodada (ver refund
    // abaixo) — antes, grupos com fila seca queimavam 100 de cota pra mandar
    // 0-1 e-mail e a cota do dia evaporava em ~6h com só ~1.700 envios reais.
    const { data: allowed, error: quotaError } = await supabase.rpc("claim_mass_email_quota", { p_want: BATCH_SIZE });
    if (quotaError) throw new Error(quotaError.message);
    const wantBatch = allowed ?? 0;
    if (wantBatch <= 0) {
      return new Response(JSON.stringify({ ok: true, group, sent: 0, message: "cota diaria de campanhas atingida" }), { status: 200 });
    }

    let rows: any[] = [];
    if (group === "g1") {
      const { data, error } = await supabase.rpc("get_mass_email_g1_batch", { batch_size: wantBatch });
      if (error) throw new Error(error.message);
      rows = data || [];
    } else if (group === "g2") {
      const { data, error } = await supabase.rpc("get_mass_email_g2_batch", { batch_size: wantBatch });
      if (error) throw new Error(error.message);
      rows = data || [];
    } else {
      let dateGte: string, dateLte: string;
      if (group === "g3") { dateGte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); dateLte = new Date().toISOString(); }
      else if (group === "g4") { dateGte = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); dateLte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); }
      else { dateGte = "2000-01-01"; dateLte = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); }
      const { data, error } = await supabase.rpc("get_mass_email_window_batch", {
        p_kind: `mass_email_${group}`,
        p_date_gte: dateGte,
        p_date_lte: dateLte,
        batch_size: wantBatch,
      });
      if (error) throw new Error(error.message);
      rows = data || [];
    }
    if (!rows.length) {
      // fila seca: devolve a reserva inteira pra outro grupo usar hoje
      await supabase.rpc("refund_mass_email_quota", { p_amount: wantBatch }).then(
        () => {}, (e: unknown) => console.error("[mass] refund fail:", String(e)));
      return new Response(JSON.stringify({ ok: true, group, sent: 0, refunded: wantBatch, message: "grupo concluido" }), { status: 200 });
    }
    let sent = 0, skipped = 0;
    for (const profile of rows) {
      const email = profile.email;
      if (!email || email.includes("@doramasplus")) { skipped++; continue; }
      const name = String(profile.name || "").split(" ")[0] || "você";

      // Reserva a vaga ANTES de mandar o email (insert com a unique index
      // user_id+day como trava). Se outra execucao concorrente ja reservou
      // pra esse usuario hoje (mesmo que de outro grupo), a gente desiste sem
      // nem tentar mandar de novo -- fecha a corrida que mandava email duplicado.
      const { data: claimed, error: claimError } = await supabase
        .from("whatsapp_renewal_logs")
        .insert({ user_id: profile.id, kind: `mass_email_${group}`, provider: "resend", sent_to: email, template_name: `mass_email_${group}`, meta: { group } })
        .select("id")
        .single();

      if (claimError) { skipped++; continue; }

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: subjects[group], html: buildHtml(name, group) }),
        });
        if (!res.ok) {
          // Envio falhou -- libera a vaga pra proxima execucao poder tentar de novo
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
    // ✅ 19/08: devolve o que reservou e não usou (fila menor que a reserva,
    // e-mails fake pulados, claims duplicados, falhas do Resend).
    const unused = Math.max(wantBatch - sent, 0);
    if (unused > 0) {
      await supabase.rpc("refund_mass_email_quota", { p_amount: unused }).then(
        () => {}, (e: unknown) => console.error("[mass] refund fail:", String(e)));
    }
    return new Response(JSON.stringify({ ok: true, group, sent, skipped, refunded: unused }), { status: 200 });
  } catch (e) { return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 }); }
});
