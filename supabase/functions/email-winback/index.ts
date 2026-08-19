// email-winback v1 (19/08/2026): e-mail pra quem VENCEU e não renovou — a
// janela que não tinha nada (entre o vencimento e o G2 aos 60 dias).
// Dois toques: 7 dias e 21 dias depois do fim da cobertura.
//
// Contexto/decisões (Stefano aprovou 19/08, liberou direto sem teste):
// - O return_7d por WHATSAPP foi desativado por 0% de conversão — este aqui
//   é diferente: e-mail, foco em CONTEÚDO novo (não "renova aí"), com CTA de
//   renovação por último. Se medir 0% também, matar o cron sem dó.
// - Exclui "DoramasPlus Passe Teste" (funil próprio, âncora de preço outra).
// - Dedupe 45d por kind: quem renovar e vencer de novo pode receber outro
//   ciclo. Claim-first no log (lição do email-mass-sender v18).
// - Preço citado: mensal R$ 17,90 (vigente desde ~27/07/2026).
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

const CATEGORIES = [
  { key: "is_taboo_relationship" },
  { key: "is_bl_gl" },
  { key: "is_anime" },
  { key: "is_hidden_identity" },
  { key: "is_baby_pregnancy" },
];

type Kind = "winback_7d" | "winback_21d";

// Janela = dias desde o FIM da cobertura (start <= dias < end)
const WINDOWS: Record<Kind, { start: number; end: number }> = {
  winback_7d: { start: 7, end: 8 },
  winback_21d: { start: 21, end: 22 },
};

const MAX_PER_RUN = 400;

async function runSql(q: string): Promise<any[]> {
  const { data, error } = await supabase.rpc("exec_sql", { q });
  if (error) throw new Error(`exec_sql: ${JSON.stringify(error)}`);
  return Array.isArray(data) ? data : [];
}

async function getFavoriteCategoryKey(userId: string): Promise<string | null> {
  const { data: history } = await supabase
    .from("watch_history").select("dorama_id").eq("user_id", userId).limit(300);
  if (!history?.length) return null;
  const doramaIds = [...new Set(history.map((h: any) => h.dorama_id))].slice(0, 100);
  const { data: doramas } = await supabase.from("doramas")
    .select("id, is_taboo_relationship, is_bl_gl, is_anime, is_hidden_identity, is_baby_pregnancy")
    .in("id", doramaIds);
  if (!doramas?.length) return null;
  const counts: Record<string, number> = {};
  for (const cat of CATEGORIES) counts[cat.key] = 0;
  for (const d of doramas) for (const cat of CATEGORIES) if ((d as any)[cat.key]) counts[cat.key]++;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] === 0) return null;
  return top[0];
}

async function getRecentDoramas(categoryKey: string | null, limit = 4): Promise<string[]> {
  let q = supabase.from("doramas").select("title").order("created_at", { ascending: false }).limit(limit);
  if (categoryKey) q = q.eq(categoryKey, true);
  const { data } = await q;
  const titles = (data || []).map((d: any) => d.title);
  if (titles.length > 0) return titles;
  const { data: anyN } = await supabase.from("doramas").select("title")
    .order("created_at", { ascending: false }).limit(limit);
  return (anyN || []).map((d: any) => d.title);
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SUBJECTS: Record<Kind, string> = {
  winback_7d: "Chegou muita coisa nova desde que você saiu 💜",
  winback_21d: "A gente guardou seu lugar (e seus favoritos) 💜",
};

function buildHtml(name: string, kind: Kind, doramas: string[]): string {
  const doramaList = doramas.length
    ? `<ul style="margin:12px 0;padding-left:20px;">${doramas.map((t) => `<li style="margin:6px 0;color:#e2e8f0;font-size:15px;">${esc(t)}</li>`).join("")}</ul>`
    : "";

  const msgs: Record<Kind, { headline: string; body: string }> = {
    winback_7d: {
      headline: "Olha o que chegou essa semana...",
      body: `Oi, <strong>${esc(name)}</strong>! 👋<br><br>
        Seu acesso venceu há uma semana — e desde então não paramos de subir dorama novo. Olha só o que você tá perdendo:<br>
        ${doramaList}
        Seu histórico e seus favoritos continuam salvos, é só voltar de onde parou. 💜`,
    },
    winback_21d: {
      headline: "Seu lugar continua guardado 💜",
      body: `Oi, <strong>${esc(name)}</strong>! 😊<br><br>
        Já faz 3 semanas que seu acesso venceu, mas sua conta continua aqui — com seu histórico e seus favoritos intactos. E o catálogo só cresceu:<br>
        ${doramaList}
        Volta pra maratonar com a gente? 🎬`,
    },
  };

  const m = msgs[kind];
  const cta = `${PLANS_LINK}?utm_source=email&utm_medium=crm&utm_campaign=${kind}`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;overflow:hidden;">
<tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);padding:32px;text-align:center;">
<h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">DoramasPlus 💜</h1>
<p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">${m.headline}</p>
</td></tr>
<tr><td style="padding:36px 40px;">
<p style="margin:0 0 24px;color:#cbd5e1;font-size:15px;line-height:1.8;">${m.body}</p>
<table cellpadding="0" cellspacing="0" style="margin:0 auto 12px;"><tr><td style="background:linear-gradient(135deg,#6c2bd9,#a855f7);border-radius:10px;">
<a href="${cta}" style="display:inline-block;padding:14px 36px;color:#fff;font-size:16px;font-weight:700;text-decoration:none;">Renovar agora →</a>
</td></tr></table>
<p style="margin:0 0 24px;color:#94a3b8;font-size:13px;text-align:center;">A partir de R$ 17,90/mês &middot; Pix na hora, sem burocracia</p>
<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;"><tr><td style="background:rgba(168,85,247,0.14);border:1px solid rgba(168,85,247,0.4);border-radius:12px;padding:16px 18px;text-align:center;">
<p style="margin:0 0 6px;color:#f3e8ff;font-size:16px;font-weight:800;">📱 Baixe o app oficial da DoramasPlus!</p>
<a href="${PLAY_STORE_URL}" style="color:#c084fc;font-size:15px;font-weight:700;text-decoration:underline;">Baixar agora na Google Play →</a>
</td></tr></table>
<p style="margin:0 0 8px;color:#64748b;font-size:13px;">Dúvidas? Fale com a gente pelo WhatsApp: <a href="${SUPORTE_LINK}" style="color:#a855f7;">(18) 99679-6654</a></p>
<p style="margin:0;color:#64748b;font-size:13px;">Entre na nossa comunidade: <a href="${COMUNIDADE_LINK}" style="color:#a855f7;">clique aqui</a></p>
</td></tr>
<tr><td style="background:#111827;padding:20px 40px;text-align:center;">
<p style="margin:0;color:#475569;font-size:12px;">&copy; 2026 DoramasPlus &middot; Você recebe este email por ter sido assinante da plataforma.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

async function processKind(kind: Kind): Promise<{ eligible: number; sent: number; skipped: number }> {
  const w = WINDOWS[kind];
  // Elegível = cobertura mais RECENTE do usuário terminou na janela (se
  // tivesse renovado, a mais recente estaria no futuro), não é Passe Teste,
  // e-mail válido, sem esse kind nos últimos 45d.
  const rows = await runSql(`
    with sub as (
      select distinct on (user_id) user_id, status, provider, end_at, current_period_end, plan_name
      from subscriptions
      order by user_id, coalesce(end_at, current_period_end) desc nulls last
    )
    select p.id as user_id, p.email, coalesce(p.name,'') as name
    from sub s
    join profiles p on p.id = s.user_id
    where coalesce(s.end_at, s.current_period_end) is not null
      and coalesce(s.end_at, s.current_period_end) < now() - interval '${w.start} days'
      and coalesce(s.end_at, s.current_period_end) >= now() - interval '${w.end} days'
      and coalesce(s.plan_name,'') <> 'DoramasPlus Passe Teste'
      and p.email is not null and p.email not ilike '%@doramasplus%'
      and not exists (
        select 1 from whatsapp_renewal_logs l
        where l.user_id = p.id and l.kind = '${kind}'
          and l.created_at > now() - interval '45 days')
    limit ${MAX_PER_RUN}
  `);

  let sent = 0, skipped = 0;
  for (const r of rows) {
    const userId = String(r.user_id);
    const email = String(r.email || "");
    const name = String(r.name || "").split(" ")[0] || "você";

    const { data: claim, error: claimErr } = await supabase
      .from("whatsapp_renewal_logs")
      .insert({ user_id: userId, kind, provider: "resend", sent_to: email, template_name: kind, meta: { reason: "claimed" } })
      .select("id").single();
    if (claimErr || !claim) { skipped++; continue; }

    try {
      const categoryKey = await getFavoriteCategoryKey(userId);
      const doramas = await getRecentDoramas(categoryKey);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: SUBJECTS[kind], html: buildHtml(name, kind, doramas) }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}`);
      await supabase.from("whatsapp_renewal_logs").update({ meta: { reason: "sent", category: categoryKey || null } }).eq("id", claim.id);
      sent++;
    } catch (e) {
      await supabase.from("whatsapp_renewal_logs").delete().eq("id", claim.id);
      console.error(`[winback] send fail ${kind} ${userId}:`, String(e));
      skipped++;
    }
  }
  return { eligible: rows.length, sent, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "HEAD") return new Response(null, { status: 200 });
  try {
    const r7 = await processKind("winback_7d");
    const r21 = await processKind("winback_21d");
    const out = { ok: true, winback_7d: r7, winback_21d: r21 };
    console.log("[email-winback] done:", JSON.stringify(out));
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[email-winback] fatal:", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200 });
  }
});
