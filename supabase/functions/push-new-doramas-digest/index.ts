// ✅ 25/07: sugestão diária de dorama via push, personalizada por pessoa —
// substituiu a ideia inicial de "resumo de tudo que entrou hoje" (spam se
// vários títulos sobem no mesmo dia). Agora, 1x/dia, cada assinante recebe
// UM título só, com pôster + link direto, igual apps grandes fazem:
// - Tem histórico (watch_history)? Pega a categoria que mais assiste
//   (mesma lógica de recomendarDoramas do dora-chat) e sorteia um título
//   dessa categoria que ainda não assistiu.
// - Sem histórico, ou categoria sem título disponível? Sorteia um dorama
//   qualquer do catálogo.
// Rodado via pg_cron (ver migration schedule_push_new_doramas_digest).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUser } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const CATEGORIA_TRAITS = [
  "is_taboo_relationship",
  "is_hidden_identity",
  "is_bl_gl",
  "is_lobos_vampiros",
  "is_anime",
  "is_brasileiro",
  "is_baby_pregnancy",
] as const;

type DoramaPick = { title: string; slug: string; cover_url: string | null; description: string | null };

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

async function pickAnyRandomDorama(excludeIds: string[]): Promise<DoramaPick | null> {
  let query = supabase
    .from("doramas")
    .select("title, slug, cover_url, description, id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (excludeIds.length) query = query.not("id", "in", `(${excludeIds.join(",")})`);
  const { data } = await query;
  return pickRandom(data || []);
}

async function pickDoramaForUser(userId: string): Promise<DoramaPick | null> {
  const { data: history } = await supabase
    .from("watch_history")
    .select("dorama_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);

  const watchedIds = [...new Set((history || []).map((h) => h.dorama_id))];
  if (watchedIds.length === 0) return pickAnyRandomDorama([]);

  const { data: watched } = await supabase
    .from("doramas")
    .select("id, " + CATEGORIA_TRAITS.join(", "))
    .in("id", watchedIds);

  if (!watched || watched.length === 0) return pickAnyRandomDorama(watchedIds);

  const counts = CATEGORIA_TRAITS.map((col) => ({
    col,
    count: watched.filter((d: any) => d[col]).length,
  })).sort((a, b) => b.count - a.count);

  const topTrait = counts[0]?.count > 0 ? counts[0].col : null;
  if (!topTrait) return pickAnyRandomDorama(watchedIds);

  const excludeList = `(${watchedIds.join(",")})`;
  const { data: candidates } = await supabase
    .from("doramas")
    .select("title, slug, cover_url, description")
    .eq(topTrait, true)
    .not("id", "in", excludeList)
    .limit(50);

  const pick = pickRandom(candidates || []);
  return pick || pickAnyRandomDorama(watchedIds);
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const url = new URL(req.url);
    const theirs = req.headers.get("x-cron-secret") || url.searchParams.get("cron_secret") || "";
    if (theirs !== CRON_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }
  }

  try {
    const { data: subs } = await supabase.from("push_subscriptions").select("user_id");
    const userIds = [...new Set((subs || []).map((s) => s.user_id))];

    let sent = 0;
    for (const userId of userIds) {
      const dorama = await pickDoramaForUser(userId);
      if (!dorama) continue;

      const descricao = (dorama.description || "").trim();
      const body = descricao.length > 100 ? `${descricao.slice(0, 100)}...` : descricao || "Assista agora! 🎬";

      const result = await sendPushToUser(supabase, userId, {
        title: dorama.title,
        body,
        url: `/dorama/${dorama.slug}`,
        image: dorama.cover_url || undefined,
        // ✅ 25/07: play button roxo no lugar do logo, só nesse push — gatilho
        // visual pra pessoa associar com "tem vídeo esperando".
        icon: '/notification-icon-192.png',
        cta: 'Assistir Agora ▶',
      });
      sent += result.sent;
    }

    return new Response(JSON.stringify({ ok: true, users: userIds.length, sent }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
