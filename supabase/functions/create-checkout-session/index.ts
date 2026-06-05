import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ===== 1) ENV VARS =====
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceMensal = Deno.env.get("STRIPE_PRICE_ID_MENSAL");
    const priceTrimestral = Deno.env.get("STRIPE_PRICE_ID_TRIMESTRAL");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error("Supabase env vars ausentes");
    }

    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY ausente");
    }

    // ===== 2) AUTH =====
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization header ausente" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Token vazio" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Usuário não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== 3) BODY =====
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const plan = body?.plan; // 'monthly' | 'quarterly'

    let selectedPriceId: string | null = null;

    if (plan === "quarterly") {
      selectedPriceId = priceTrimestral ?? null;
    } else if (plan === "monthly") {
      selectedPriceId = priceMensal ?? null;
    } else {
      // Se vier algo errado, bloqueia (não deixa cair no mensal sem querer)
      return new Response(
        JSON.stringify({ error: "Plano inválido. Use monthly ou quarterly." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!selectedPriceId) {
      throw new Error(`Price ID não configurado para o plano: ${plan}`);
    }

    // ===== 4) PROFILE =====
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr) {
      console.error("Erro ao buscar profile:", profileErr);
    }

    // ✅ FIXO: não depende de origin (evita bug em iPhone/webview)
    const origin = "https://doramasplus.com.br";

    // ===== 5) STRIPE PARAMS =====
    // Monta os params do checkout. `mode` controla como o cliente é identificado:
    //  - "customer": reaproveita o stripe_customer_id salvo no profile
    //  - "email":    identifica/cria pelo e-mail (fallback seguro)
    const buildParams = (mode: "customer" | "email") => {
      const params = new URLSearchParams();
      params.append("success_url", `${origin}/checkout/sucesso`);
      params.append("cancel_url", `${origin}/checkout/cancelado`);
      params.append("line_items[0][price]", selectedPriceId as string);
      params.append("line_items[0][quantity]", "1");
      params.append("mode", "subscription");
      params.append("client_reference_id", user.id);
      params.append("locale", "pt-BR");

      // ✅ ESSENCIAL: metadata no checkout.session
      // (é isso que o webhook consegue ler em checkout.session.completed)
      params.append("metadata[user_id]", user.id);
      if (user.email) params.append("metadata[email]", user.email);

      // ✅ BLINDAGEM: metadata também dentro da subscription
      params.append("subscription_data[metadata][user_id]", user.id);
      if (user.email)
        params.append("subscription_data[metadata][email]", user.email);

      if (mode === "customer" && profile?.stripe_customer_id) {
        params.append("customer", profile.stripe_customer_id);
      } else if (user.email) {
        // evita mandar vazio
        params.append("customer_email", user.email);
      }

      return params;
    };

    const callStripe = async (params: URLSearchParams) => {
      const response = await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeSecretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        }
      );
      const data = await response.json();
      return { response, data };
    };

    const useCustomer = !!profile?.stripe_customer_id;

    console.log(
      `Checkout | user=${user.id} | plan=${plan} | price=${selectedPriceId} | origin=${origin} | useCustomer=${useCustomer}`
    );

    // ===== 6) STRIPE CALL =====
    let { response, data: stripeData } = await callStripe(
      buildParams(useCustomer ? "customer" : "email")
    );

    // ✅ FALLBACK: se o customer salvo não existe mais na conta Stripe atual
    // (ex.: chaves trocadas / customer deletado), a Stripe retorna 400
    // "No such customer". Nesse caso refazemos a sessão SEM o `customer`,
    // identificando pelo e-mail, e limpamos o id inválido do profile.
    const msg = String(stripeData?.error?.message || "");
    const isMissingCustomer =
      !response.ok &&
      useCustomer &&
      (stripeData?.error?.code === "resource_missing" ||
        /no such customer/i.test(msg)) &&
      (stripeData?.error?.param === "customer" || /customer/i.test(msg));

    if (isMissingCustomer) {
      console.warn(
        `customer inválido (${profile?.stripe_customer_id}) p/ user=${user.id}. Refazendo sem customer.`
      );

      ({ response, data: stripeData } = await callStripe(buildParams("email")));

      // limpa o customer_id inválido (não bloqueia o checkout se falhar)
      try {
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_customer_id: null })
          .eq("id", user.id);
      } catch (e) {
        console.error("Falha ao limpar stripe_customer_id inválido:", String(e));
      }
    }

    if (!response.ok) {
      console.error("Stripe erro:", stripeData);
      return new Response(
        JSON.stringify({
          error: stripeData?.error?.message || "Erro Stripe",
          stripe: stripeData,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ===== 7) SUCCESS =====
    return new Response(JSON.stringify({ url: stripeData.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("EDGE FUNCTION ERROR:", error);
    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
