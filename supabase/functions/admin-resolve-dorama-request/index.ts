// admin-resolve-dorama-request: painel /admin/doramas usa isso pra marcar
// um grupo de pedidos como "tenho" (liga a um dorama real do catálogo,
// avisa quem pediu via dora_conversations + push), "não tenho" (avisa
// que não vai rolar, com motivo opcional, e descarta — motivo fica salvo
// pra aparecer no histórico do painel), "aguardar" (avisa que ainda
// não tem mas fica de olho, sem descartar o pedido — continua pendente
// pra pegar o aviso automático depois, se/quando o dorama for adicionado),
// "aguardar_indeterminado" (mesma ideia do aguardar, mas avisa que não
// tem previsão nenhuma de quando ou se vai conseguir — pra separar do
// aguardando comum no painel e não criar falsa expectativa de prazo), ou
// "downgrade_indefinite" (09/08: tira do "tempo indeterminado" de volta
// pro "aguardando" comum, sem resolver — usado quando o admin descobre
// alguma expectativa nova mas o título ainda não foi adicionado de verdade;
// antes disso não tinha como reverter, o pedido ficava preso no indeterminado
// pra sempre, achado pelo Leandro tentando mover um pedido de volta).
// Mesmo padrão de auth de admin-send-push / admin-dorama-requests: JWT
// validado contra ADMIN_EMAIL, depois service role pra fazer o trabalho
// de verdade.
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

const ADMIN_EMAIL = "tessuportegeral@gmail.com";

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
    if ((userData.user.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "forbidden" }, 403);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
    if (!ids.length) return json({ ok: false, error: "ids_required" }, 400);

    if (action === "dismiss") {
      const reason = String(body?.reason || "").trim();
      const doramaName = String(body?.dorama_name || "esse título");

      const { data: rows } = await admin
        .from("dorama_requests")
        .select("id, user_id")
        .in("id", ids)
        .is("notified_at", null)
        .is("dismissed_at", null);

      const targets = rows || [];
      const withUser = targets.filter((r: any) => r.user_id);

      const mensagem = reason
        ? `Sobre o pedido de *${doramaName}*: ${reason} 😢`
        : `Sobre o pedido de *${doramaName}*: infelizmente não vamos conseguir adicionar esse título por enquanto 😢`;

      if (withUser.length) {
        await admin.from("dora_conversations").insert(
          withUser.map((r: any) => ({
            session_id: "system-notify-" + r.id,
            user_id: r.user_id,
            role: "admin",
            content: mensagem,
            needs_human: false,
          }))
        );
      }

      let pushSent = 0;
      for (const r of withUser) {
        const res = await sendPushToUser(admin, r.user_id, {
          title: "Sobre o seu pedido de dorama",
          body: reason || `${doramaName} não vai rolar por enquanto`,
          url: "/",
        });
        pushSent += res.sent;
      }

      const { error } = await admin
        .from("dorama_requests")
        .update({ dismissed_at: new Date().toISOString(), dismiss_reason: reason || null })
        .in("id", ids)
        .is("notified_at", null);
      if (error) throw new Error(error.message);

      return json({ ok: true, dismissed: ids.length, notified_conversations: withUser.length, push_sent: pushSent });
    }

    if (action === "acknowledge") {
      const reason = String(body?.reason || "").trim();
      const doramaName = String(body?.dorama_name || "esse título");

      const { data: rows } = await admin
        .from("dorama_requests")
        .select("id, user_id")
        .in("id", ids)
        .is("notified_at", null)
        .is("dismissed_at", null)
        .is("acknowledged_at", null);

      const targets = rows || [];
      const withUser = targets.filter((r: any) => r.user_id);

      const mensagem = reason
        ? `Sobre o pedido de *${doramaName}*: ${reason}`
        : `Sobre o pedido de *${doramaName}*: está na fila pra subir, assim que tiver disponível te envio o link dele aqui no chat e no painel de pedir doramas`;

      if (withUser.length) {
        await admin.from("dora_conversations").insert(
          withUser.map((r: any) => ({
            session_id: "system-notify-" + r.id,
            user_id: r.user_id,
            role: "admin",
            content: mensagem,
            needs_human: false,
          }))
        );
      }

      let pushSent = 0;
      for (const r of withUser) {
        const res = await sendPushToUser(admin, r.user_id, {
          title: "Sobre o seu pedido de dorama",
          body: reason || `${doramaName}: está na fila pra subir!`,
          url: "/",
        });
        pushSent += res.sent;
      }

      const { error } = await admin
        .from("dorama_requests")
        .update({ acknowledged_at: new Date().toISOString() })
        .in("id", ids)
        .is("notified_at", null)
        .is("dismissed_at", null)
        .is("acknowledged_at", null);
      if (error) throw new Error(error.message);

      return json({ ok: true, acknowledged: targets.length, notified_conversations: withUser.length, push_sent: pushSent });
    }

    if (action === "acknowledge_indefinite") {
      const reason = String(body?.reason || "").trim();
      const doramaName = String(body?.dorama_name || "esse título");

      const { data: rows } = await admin
        .from("dorama_requests")
        .select("id, user_id")
        .in("id", ids)
        .is("notified_at", null)
        .is("dismissed_at", null)
        .is("indefinite_at", null);

      const targets = rows || [];
      const withUser = targets.filter((r: any) => r.user_id);

      const mensagem = reason
        ? `Sobre o pedido de *${doramaName}*: ${reason}`
        : `Sobre o pedido de *${doramaName}*: no momento não temos esse título e não temos previsão de quando (ou se) vamos conseguir adicionar. Fica anotado aqui — se um dia rolar, aviso você por aqui 🤞`;

      if (withUser.length) {
        await admin.from("dora_conversations").insert(
          withUser.map((r: any) => ({
            session_id: "system-notify-" + r.id,
            user_id: r.user_id,
            role: "admin",
            content: mensagem,
            needs_human: false,
          }))
        );
      }

      let pushSent = 0;
      for (const r of withUser) {
        const res = await sendPushToUser(admin, r.user_id, {
          title: "Sobre o seu pedido de dorama",
          body: reason || `${doramaName}: sem previsão de adicionar no momento, mas está anotado.`,
          url: "/",
        });
        pushSent += res.sent;
      }

      const { error } = await admin
        .from("dorama_requests")
        .update({
          acknowledged_at: new Date().toISOString(),
          indefinite_at: new Date().toISOString(),
        })
        .in("id", ids)
        .is("notified_at", null)
        .is("dismissed_at", null)
        .is("indefinite_at", null);
      if (error) throw new Error(error.message);

      return json({ ok: true, acknowledged: targets.length, notified_conversations: withUser.length, push_sent: pushSent });
    }

    // ✅ 09/08: volta um pedido de "tempo indeterminado" pra "aguardando"
    // comum, sem resolver — antes disso não existia caminho de volta, o
    // pedido ficava preso no indeterminado mesmo quando o admin encontrava
    // alguma expectativa nova (mas o título ainda não tinha sido adicionado
    // de verdade, então "resolve" não se aplicava ainda).
    if (action === "downgrade_indefinite") {
      const doramaName = String(body?.dorama_name || "esse título");

      const { data: rows } = await admin
        .from("dorama_requests")
        .select("id, user_id")
        .in("id", ids)
        .is("notified_at", null)
        .is("dismissed_at", null)
        .not("indefinite_at", "is", null);

      const targets = rows || [];
      const withUser = targets.filter((r: any) => r.user_id);

      const mensagem = `Atualizando sobre o pedido de *${doramaName}*: voltou pra fila normal de acompanhamento — assim que tiver novidade te aviso por aqui de novo! 🙏`;

      if (withUser.length) {
        await admin.from("dora_conversations").insert(
          withUser.map((r: any) => ({
            session_id: "system-notify-" + r.id,
            user_id: r.user_id,
            role: "admin",
            content: mensagem,
            needs_human: false,
          }))
        );
      }

      let pushSent = 0;
      for (const r of withUser) {
        const res = await sendPushToUser(admin, r.user_id, {
          title: "Sobre o seu pedido de dorama",
          body: `${doramaName}: voltou pra fila de acompanhamento.`,
          url: "/",
        });
        pushSent += res.sent;
      }

      const { error } = await admin
        .from("dorama_requests")
        .update({ indefinite_at: null })
        .in("id", ids)
        .is("notified_at", null)
        .is("dismissed_at", null)
        .not("indefinite_at", "is", null);
      if (error) throw new Error(error.message);

      return json({ ok: true, downgraded: targets.length, notified_conversations: withUser.length, push_sent: pushSent });
    }

    if (action === "resolve") {
      const doramaId = String(body?.dorama_id || "");
      if (!doramaId) return json({ ok: false, error: "dorama_id_required" }, 400);

      const { data: dorama } = await admin.from("doramas").select("title, slug").eq("id", doramaId).maybeSingle();
      if (!dorama) return json({ ok: false, error: "dorama_not_found" }, 404);

      const { data: rows } = await admin
        .from("dorama_requests")
        .select("id, user_id")
        .in("id", ids)
        .is("notified_at", null);

      const targets = rows || [];
      const withUser = targets.filter((r: any) => r.user_id);

      if (withUser.length) {
        await admin.from("dora_conversations").insert(
          withUser.map((r: any) => ({
            session_id: "system-notify-" + r.id,
            user_id: r.user_id,
            role: "admin",
            content:
              "🎬 Chegou o que você pediu! *" + dorama.title + "* já está disponível no DoramasPlus. Vem assistir: https://www.doramasplus.com.br/dorama/" + dorama.slug,
            needs_human: false,
          }))
        );
      }

      let pushSent = 0;
      for (const r of withUser) {
        const res = await sendPushToUser(admin, r.user_id, {
          title: "🎬 Chegou o que você pediu!",
          body: `${dorama.title} já está disponível no DoramasPlus`,
          url: `/dorama/${dorama.slug}`,
        });
        pushSent += res.sent;
      }

      const { error: updErr } = await admin
        .from("dorama_requests")
        .update({ notified_at: new Date().toISOString(), dorama_id: doramaId })
        .in("id", ids)
        .is("notified_at", null);
      if (updErr) throw new Error(updErr.message);

      return json({ ok: true, resolved: targets.length, notified_conversations: withUser.length, push_sent: pushSent });
    }

    return json({ ok: false, error: "invalid_action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
