// ✅ 25/07: sugestão diária de dorama via push, personalizada por pessoa —
// substituiu a ideia inicial de "resumo de tudo que entrou hoje" (spam se
// vários títulos sobem no mesmo dia). Agora, cada assinante recebe
// UM título só, com pôster + link direto, igual apps grandes fazem:
// - Tem histórico (watch_history)? Pega a categoria que mais assiste
//   (mesma lógica de recomendarDoramas do dora-chat) e sorteia um título
//   dessa categoria que ainda não assistiu.
// - Sem histórico, ou categoria sem título disponível? Sorteia um dorama
//   qualquer do catálogo.
// Rodado via pg_cron (ver migration schedule_push_new_doramas_digest e
// national_holidays_and_extra_push_digest_crons).
//
// ✅ 28/07: achado que o log em push_digest_log nunca gravava uma linha
// sequer desde que foi criado (26/07), apesar do cron rodar "com sucesso"
// (pg_cron só confirma que enfileirou a chamada HTTP, não que ela terminou
// — net.http_post é fire-and-forget). Testado isoladamente: a causa real
// não era o loop em si (nem paralelo nem sequencial), era o
// Image.decode/encode do imagescript (montagem do ícone com pôster+badge)
// estourando o limite de memória da Edge Function (WORKER_RESOURCE_LIMIT) —
// acontecia até processando 1 usuário por vez. Fix: essa function agora só
// USA o ícone já cacheado em doramas.notification_icon_url; nunca monta
// imagem nova aqui. Se um dorama ainda não tem ícone cacheado, o push cai
// pro ícone padrão em vez de tentar montar na hora. Também grava o log num
// finally, pra sempre ter visibilidade do que rodou mesmo se algo travar
// no meio.
//
// ✅ 04/08: 5 crons/dia batem nesta function (9h/12h/16h/18h/20h BRT). Até
// aqui, dia normal só deixava passar 12h e 20h (os outros 3 retornavam
// cedo sem mandar nada) e só em dia especial (sexta, sábado, domingo,
// feriado nacional ou véspera de feriado) os 5 horários disparavam de
// verdade. A pedido do Stefano, dia normal ganhou 9h e 16h também — agora
// só o 18h fica reservado pra dia especial (4 disparos/dia normal, 5 em
// dia especial). Não sorteia mais dorama com description placeholder
// "Sem Sinopse ...", nem dorama sem bunny_url/bunny_stream_url cadastrado
// (sem stream = link quebrado ao clicar). O pôster vai com um corte 4:3
// (via Bunny Optimizer) pra notificação expandida ficar um pouco menor
// que o pôster inteiro 2:3.
//
// ✅ 12/08: descoberto que a "outra function" que deveria cachear o ícone
// (notification_icon_url) NUNCA foi criada — nenhum dorama subido depois
// de 28/07 tinha ícone e todo push saía com o ícone genérico do app
// (Stefano viu como "logo bugado"). Fix sem imagescript e sem memória:
// o ícone agora é o próprio pôster redimensionado 192x192 POR URL via
// Bunny Optimizer (mesma técnica do corte 4:3 da imagem grande) — todos
// os covers recentes estão no b-cdn.net. Cache/notification_icon_url
// continua valendo como 1ª opção se existir.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUser } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

// Quantos usuários processar em paralelo por vez. Agora que a montagem de
// ícone (pesada em memória) saiu do caminho de envio, cada iteração é só
// algumas queries + 1 chamada de push — pode paralelizar sem medo de
// estourar o limite de recursos da Edge Function.
const BATCH_SIZE = 15;

const CATEGORIA_TRAITS = [
  "is_taboo_relationship",
  "is_hidden_identity",
  "is_bl_gl",
  "is_lobos_vampiros",
  "is_anime",
  "is_brasileiro",
  "is_baby_pregnancy",
] as const;

type DoramaRow = {
  id: string;
  title: string;
  slug: string;
  cover_url: string | null;
  description: string | null;
  notification_icon_url: string | null;
  bunny_url: string | null;
  bunny_stream_url: string | null;
};

type DoramaPick = Omit<DoramaRow, "bunny_url" | "bunny_stream_url">;

const DORAMA_SELECT = "id, title, slug, cover_url, description, notification_icon_url, bunny_url, bunny_stream_url";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Só entra no sorteio quem tem stream de verdade cadastrado — senão o
// push manda a pessoa pra uma página sem vídeo pra assistir.
function hasStream(d: DoramaRow): boolean {
  return !!((d.bunny_url || "").trim() || (d.bunny_stream_url || "").trim());
}

function toPick(d: DoramaRow): DoramaPick {
  const { bunny_url, bunny_stream_url, ...rest } = d;
  return rest;
}

// Corte 4:3 (em vez do pôster inteiro 2:3) só pra covers já servidos pelo
// Bunny CDN, via Bunny Optimizer — os mais antigos no Supabase Storage não
// têm esse recurso de transformação por URL, então ficam com o original.
function buildNotificationImage(coverUrl: string | null): string | undefined {
  if (!coverUrl) return undefined;
  if (coverUrl.includes("b-cdn.net")) {
    const sep = coverUrl.includes("?") ? "&" : "?";
    return `${coverUrl}${sep}width=800&height=600`;
  }
  return coverUrl;
}

// ✅ 12/08 — ícone da notificação = pôster 192x192 via Bunny Optimizer
// (só transformação por URL, zero processamento de imagem aqui). Cover
// fora do b-cdn (storage antigo) não tem transformação → retorna null e o
// caller cai pro cache antigo ou pro ícone padrão do app.
function buildNotificationIcon(coverUrl: string | null): string | null {
  if (!coverUrl || !coverUrl.includes("b-cdn.net")) return null;
  const sep = coverUrl.includes("?") ? "&" : "?";
  return `${coverUrl}${sep}width=192&height=192`;
}

function getBrasiliaParts(date: Date): { dateStr: string; hour: number; weekday: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  return { dateStr: `${map.year}-${map.month}-${map.day}`, hour, weekday: map.weekday };
}

// Sexta, sábado, domingo, feriado nacional ou véspera de feriado = dia
// especial (5 disparos/dia, com 18h extra); qualquer outro dia = 9h, 12h,
// 16h e 20h BRT.
async function isSpecialDay(dateStr: string, weekday: string): Promise<boolean> {
  if (weekday === "Fri" || weekday === "Sat" || weekday === "Sun") return true;

  const tomorrow = new Date(`${dateStr}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("national_holidays")
    .select("date")
    .in("date", [dateStr, tomorrowStr]);
  return (data || []).length > 0;
}

async function pickAnyRandomDorama(excludeIds: string[]): Promise<DoramaPick | null> {
  let query = supabase
    .from("doramas")
    .select(DORAMA_SELECT)
    .not("description", "ilike", "Sem Sinopse%")
    .order("created_at", { ascending: false })
    .limit(150);
  if (excludeIds.length) query = query.not("id", "in", `(${excludeIds.join(",")})`);
  const { data } = await query;
  const candidates = (data || []).filter(hasStream);
  const pick = pickRandom(candidates);
  return pick ? toPick(pick) : null;
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
  const { data: candidatesRaw } = await supabase
    .from("doramas")
    .select(DORAMA_SELECT)
    .eq(topTrait, true)
    .not("id", "in", excludeList)
    .not("description", "ilike", "Sem Sinopse%")
    .limit(80);

  const candidates = (candidatesRaw || []).filter(hasStream);
  const pick = pickRandom(candidates);
  return pick ? toPick(pick) : pickAnyRandomDorama(watchedIds);
}

async function sendDigestToUser(userId: string): Promise<number> {
  try {
    const dorama = await pickDoramaForUser(userId);
    if (!dorama) return 0;

    const descricao = (dorama.description || "").trim();
    const body = descricao.length > 100 ? `${descricao.slice(0, 100)}...` : descricao || "Assista agora! 🎬";

    // ✅ 12/08: ícone = pôster 192x192 por URL (Bunny). Cache antigo
    // (notification_icon_url) continua valendo como 2ª opção; padrão do
    // app é o último recurso. Nunca monta imagem aqui (WORKER_RESOURCE_LIMIT).
    const result = await sendPushToUser(supabase, userId, {
      title: dorama.title,
      body,
      url: `/dorama/${dorama.slug}`,
      image: buildNotificationImage(dorama.cover_url),
      icon: buildNotificationIcon(dorama.cover_url) || dorama.notification_icon_url || "/notification-icon-192.png",
      cta: 'Assistir Agora ▶',
    });
    return result.sent;
  } catch (e) {
    // Falha em UM usuário (imagem quebrada, endpoint de push morto, etc.)
    // não pode derrubar o lote inteiro nem impedir os outros de receber.
    console.error("[push-digest] falha ao processar usuário", userId, String(e));
    return 0;
  }
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const url = new URL(req.url);
    const theirs = req.headers.get("x-cron-secret") || url.searchParams.get("cron_secret") || "";
    if (theirs !== CRON_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }
  }

  const { dateStr, hour, weekday } = getBrasiliaParts(new Date());
  const special = await isSpecialDay(dateStr, weekday);
  const allowedHours = special ? [9, 12, 16, 18, 20] : [9, 12, 16, 20];
  if (!allowedHours.includes(hour)) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "fora da janela de horário do dia", hour, special }),
      { status: 200 }
    );
  }

  const { data: subs } = await supabase.from("push_subscriptions").select("user_id");
  const userIds = [...new Set((subs || []).map((s) => s.user_id))];

  let sent = 0;
  try {
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(sendDigestToUser));
      sent += results.reduce((a, b) => a + b, 0);
    }
  } finally {
    // ✅ 28/07: gravar o resultado sempre, mesmo que o loop acima tenha
    // sido interrompido por algum erro — antes só gravava depois do loop
    // inteiro terminar, então uma falha no meio deixava zero rastro de
    // quantos usuários realmente chegaram a ser processados.
    await supabase.from("push_digest_log").insert({
      source: "push-new-doramas-digest",
      users_eligible: userIds.length,
      sent,
    });
  }

  return new Response(JSON.stringify({ ok: true, users: userIds.length, sent, special, hour }), { status: 200 });
});
