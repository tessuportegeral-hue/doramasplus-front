// infinitepay-create-checkout (Deno runtime)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ✅ email de teste: passa direto pelo gate do Passe Teste (validação/preview)
const TRIAL_TEST_EMAIL = "tesagencia@gmail.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const handle = Deno.env.get("INFINITEPAY_HANDLE") ?? "";
    const publicBaseUrl = Deno.env.get("PUBLIC_BASE_URL") ?? "";

    const webhookUrl =
      (Deno.env.get("INFINITEPAY_WEBHOOK_URL") ?? "") ||
      (Deno.env.get("INIFITEPAY_WEBHOOK_URL") ?? "");

    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
    if (!handle) missing.push("INFINITEPAY_HANDLE");
    if (!publicBaseUrl) missing.push("PUBLIC_BASE_URL");
    if (!webhookUrl) missing.push("INFINITEPAY_WEBHOOK_URL ou INIFITEPAY_WEBHOOK_URL");

    if (missing.length) {
      console.error("[infinitepay-create-checkout] ENV ausente:", missing);
      return json({ error: "ENV ausente na Edge Function", missing }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sem Authorization" }, 401);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      console.error("[infinitepay-create-checkout] Não autenticado:", userErr?.message ?? userErr);
      return json({ error: "Não autenticado", details: userErr?.message ?? null }, 401);
    }

    const body = await req.json().catch(() => ({}));
    // ✅ planos aceitos: trial3 (Passe Teste), monthly, quarterly
    const rawPlan = body?.plan;
    const plan =
      rawPlan === "quarterly" ? "quarterly" : rawPlan === "trial3" ? "trial3" : "monthly";

    const event_id_from_front =
      typeof body?.event_id === "string" && body.event_id.trim()
        ? body.event_id.trim()
        : null;

    const source =
      typeof body?.source === "string" && body.source.trim()
        ? body.source.trim().toLowerCase()
        : "direct";

    // ✅ UTMs e fbclid
    const utm_source = typeof body?.utm_source === "string" ? body.utm_source.trim() : "";
    const utm_medium = typeof body?.utm_medium === "string" ? body.utm_medium.trim() : "";
    const utm_campaign = typeof body?.utm_campaign === "string" ? body.utm_campaign.trim() : "";
    const utm_content = typeof body?.utm_content === "string" ? body.utm_content.trim() : "";
    const fbclid = typeof body?.fbclid === "string" ? body.fbclid.trim() : "";

    const amountCents = plan === "quarterly" ? 4790 : plan === "trial3" ? 299 : 1690;
    const description =
      plan === "quarterly"
        ? "DoramasPlus Trimestral"
        : plan === "trial3"
          ? "DoramasPlus Passe Teste"
          : "DoramasPlus Padrão";

    const userId = userData.user.id;
    const userEmail = userData.user.email || "no-email@local.invalid";

    // ✅✅ GATE do Passe Teste (trial3): só para quem NÃO tem assinatura ativa
    // e nunca usou o passe teste antes (anti-farm). Usa service role p/ não depender de RLS.
    // O email de teste passa direto (pra validar o fluxo antes do lançamento).
    const isTrialTester = userEmail.toLowerCase() === TRIAL_TEST_EMAIL;
    if (plan === "trial3" && !isTrialTester) {
      if (!serviceRoleKey) {
        console.error("[trial3 gate] SERVICE_ROLE ausente");
        return json({ error: "Não foi possível validar o Passe Teste agora. Tente novamente." }, 400);
      }
      try {
        const admin = createClient(supabaseUrl, serviceRoleKey);
        const nowMs = Date.now();

        // 0) conta criada por indicação? Passe Teste não é para indicados.
        const { data: prof } = await admin
          .from("profiles")
          .select("referred_by")
          .eq("id", userId)
          .maybeSingle();

        if (prof?.referred_by) {
          return json(
            { error: "O Passe Teste não está disponível para contas criadas por indicação." },
            403,
          );
        }

        // 1) tem assinatura ativa?
        const { data: subs } = await admin
          .from("subscriptions")
          .select("status, end_at, current_period_end")
          .eq("user_id", userId);

        const isActive = (subs ?? []).some((s: any) => {
          const st = String(s?.status ?? "").toLowerCase();
          if (!["active", "trialing", "paid"].includes(st)) return false;
          const v = s?.end_at || s?.current_period_end;
          if (!v) return true;
          const t = new Date(v).getTime();
          return !Number.isNaN(t) && t > nowMs;
        });

        if (isActive) {
          return json(
            { error: "Você já tem uma assinatura ativa. O Passe Teste é só para novos usuários." },
            403,
          );
        }

        // 2) já usou o passe teste antes?
        const { count: trialCount } = await admin
          .from("pix_payments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("plan", "trial3")
          .eq("status", "paid");

        if ((trialCount ?? 0) > 0) {
          return json(
            { error: "Você já utilizou o Passe Teste. Escolha o plano mensal ou trimestral." },
            403,
          );
        }
      } catch (e) {
        console.error("[trial3 gate] erro:", String(e));
        return json({ error: "Não foi possível validar o Passe Teste agora. Tente novamente." }, 400);
      }
    }

    const order_nsu = `doramasplus|${userId}|${plan}|${Date.now()}`;

    const redirectUrl =
      `${publicBaseUrl}/checkout/sucesso` +
      `?gateway=infinitepay` +
      `&order_nsu=${encodeURIComponent(order_nsu)}` +
      `&event_id=${encodeURIComponent(event_id_from_front || order_nsu)}`;

    const payload = {
      handle,
      order_nsu,
      webhook_url: webhookUrl,
      redirect_url: redirectUrl,
      items: [{ quantity: 1, price: amountCents, description }],
      customer: { email: userEmail },
    };

    console.log("[infinitepay-create-checkout] plan:", plan);
    console.log("[infinitepay-create-checkout] source:", source);
    console.log("[infinitepay-create-checkout] utm_source:", utm_source);
    console.log("[infinitepay-create-checkout] utm_campaign:", utm_campaign);
    console.log("[infinitepay-create-checkout] fbclid:", fbclid ? "presente" : "ausente");

    // ✅ URL atualizada conforme migração InfinitePay (prazo 01/06/26)
    const resp = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    console.log("[infinitepay-create-checkout] InfinitePay status:", resp.status);

    if (!resp.ok) {
      return json(
        {
          error: "Erro ao criar checkout (InfinitePay)",
          status: resp.status,
          responseBody: parsed ?? text,
          sentPayload: payload,
        },
        400
      );
    }

    const data = parsed ?? {};
    const checkoutUrl = data?.url;

    if (!checkoutUrl) {
      return json({ error: "InfinitePay respondeu sem url", responseBody: data }, 400);
    }

    // ✅ Salva pending com UTMs e fbclid
    try {
      await supabase.from("pix_payments").insert({
        user_id: userId,
        provider: "infinitepay",
        plan,
        amount_cents: amountCents,
        order_nsu,
        status: "pending",
        raw: data,
        event_id: event_id_from_front || order_nsu,
        source,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        utm_content: utm_content || null,
        fbclid: fbclid || null,
      });
    } catch (e) {
      console.error("[infinitepay-create-checkout] falha insert pix_payments:", String(e));
    }

    return json(
      {
        url: checkoutUrl,
        order_nsu,
        event_id: event_id_from_front || order_nsu,
        redirect_url: redirectUrl,
      },
      200
    );
  } catch (e) {
    console.error("[infinitepay-create-checkout] Exception:", String(e));
    return json({ error: "Exception na Edge Function", details: String(e) }, 500);
  }
});
