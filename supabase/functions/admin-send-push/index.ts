// ✅ 25/07: disparo manual de push pro admin — mesmo padrão de autenticação
// já usado em admin-analytics (JWT do chamador validado contra ADMIN_ID,
// depois service role pra fazer o trabalho pesado).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPushToUser } from "../_shared/push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ADMIN_ID = "094e70c6-0671-4401-89fe-31aa5242348a";

type Segment = "all" | "active" | "expired";

// ✅ 25/07: segmentação por status de assinatura — pra promoção de
// reativação fazer sentido (ex: só quem venceu), não faz sentido mandar
// promoção genérica pra todo mundo, inclusive quem já tá ativo.
const SEGMENT_SQL: Record<Exclude<Segment, "all">, string> = {
  active: `
    with latest_sub as (
      select distinct on (s.user_id) s.user_id, s.status
      from public.subscriptions s
      order by s.user_id, s.end_at desc nulls last, s.created_at desc nulls last
    )
    select distinct ps.user_id
    from public.push_subscriptions ps
    join latest_sub ls on ls.user_id = ps.user_id
    where ls.status = 'active'
  `,
  expired: `
    with latest_sub as (
      select distinct on (s.user_id) s.user_id, s.status
      from public.subscriptions s
      order by s.user_id, s.end_at desc nulls last, s.created_at desc nulls last
    )
    select distinct ps.user_id
    from public.push_subscriptions ps
    join latest_sub ls on ls.user_id = ps.user_id
    where ls.status <> 'active'
  `,
};

async function getSegmentUserIds(admin: any, segment: Segment): Promise<string[]> {
  if (segment === "all") {
    const { data } = await admin.from("push_subscriptions").select("user_id");
    return [...new Set((data || []).map((r: any) => r.user_id))];
  }
  const { data, error } = await admin.rpc("exec_sql", { q: SEGMENT_SQL[segment] });
  if (error) {
    console.error("[admin-send-push] falha ao segmentar:", error);
    return [];
  }
  const rows: { user_id: string }[] = Array.isArray(data) ? data : (data as any)?.rows || [];
  return rows.map((r) => r.user_id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "no_auth" }, 401);

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthenticated" }, 401);
    if (userData.user.id !== ADMIN_ID) return json({ error: "forbidden" }, 403);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const body = await req.json().catch(() => ({}));

    // ✅ modo "stats": devolve quantos assinantes existem em cada segmento +
    // histórico de envios passados, sem mandar nada — pro admin ver antes.
    if (body?.action === "stats") {
      const [all, active, expired] = await Promise.all([
        getSegmentUserIds(admin, "all"),
        getSegmentUserIds(admin, "active"),
        getSegmentUserIds(admin, "expired"),
      ]);

      const { data: history } = await admin
        .from("push_send_log")
        .select("id, title, body, segment, sent, total, clicked, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      return json({
        ok: true,
        counts: { all: all.length, active: active.length, expired: expired.length },
        history: history || [],
      });
    }

    const title = String(body?.title || "").trim();
    const message = String(body?.body || "").trim();
    const url = String(body?.url || "/").trim() || "/";
    const segment: Segment = ["all", "active", "expired"].includes(body?.segment) ? body.segment : "all";

    if (!title || !message) return json({ error: "missing_title_or_body" }, 400);

    const userIds = await getSegmentUserIds(admin, segment);

    // ✅ 25/07: grava o log ANTES de mandar pra já ter um id pra colocar
    // no payload — assim o clique (registrado por push-click, chamado pelo
    // sw.js) sabe em qual envio incrementar o contador.
    const { data: logRow, error: logError } = await admin
      .from("push_send_log")
      .insert({ title, body: message, url, segment, sent: 0, total: userIds.length })
      .select("id")
      .single();

    if (logError || !logRow?.id) {
      return json({ ok: false, error: "falha_ao_criar_log" }, 500);
    }

    let sent = 0;
    for (const userId of userIds) {
      const r = await sendPushToUser(admin, userId, { title, body: message, url, log_id: logRow.id });
      sent += r.sent;
    }

    await admin.from("push_send_log").update({ sent }).eq("id", logRow.id);

    return json({ ok: true, sent, total: userIds.length, segment });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
