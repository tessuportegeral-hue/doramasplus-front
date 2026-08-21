// asaas-create-checkout (Deno runtime)
// Cria cobranca Pix via Asaas pro checkout do site (SubscriptionPlans.jsx),
// retornando QR code + copia-e-cola pra exibir sem sair do doramasplus.com.br.
// Criado 28/07/2026 apos a InfinitePay desativar o recebimento via link de
// pagamento (Pix e cartao) pra essa conta, decisao irreversivel deles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function generateFakeCpf(): string {
  const n = () => Math.floor(Math.random() * 9) + 1;
  const d = [n(), n(), n(), n(), n(), n(), n(), n(), n()];
  let s = d.slice(0, 9).reduce((a, v, i) => a + v * (10 - i), 0);
  let d1 = 11 - (s % 11);
  if (d1 >= 10) d1 = 0;
  d.push(d1);
  s = d.slice(0, 10).reduce((a, v, i) => a + v * (11 - i), 0);
  let d2 = 11 - (s % 11);
  if (d2 >= 10) d2 = 0;
  d.push(d2);
  return d.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const asaasKey = Deno.env.get("ASAAS_API_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ error: "ENV Supabase ausente" }, 400);
    }
    if (!asaasKey) {
      return json({ error: "ASAAS_API_KEY ausente" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sem Authorization" }, 401);
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "Token vazio" }, 401);

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error("[asaas-create-checkout] Nao autenticado:", userErr?.message ?? userErr);
      return json({ error: "Nao autenticado", details: userErr?.message ?? null }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const rawPlan = body?.plan;

    // Passe Teste (trial3) segue desativado no backend (mesma regra que a
    // InfinitePay tinha) — nunca deixar cair silenciosamente no mensal.
    if (rawPlan === "trial3") {
      return json({ error: "O Passe Teste nao esta disponivel no momento." }, 403);
    }

    const plan = rawPlan === "quarterly" ? "quarterly" : "monthly";

    const source =
      typeof body?.source === "string" && body.source.trim()
        ? body.source.trim().toLowerCase()
        : "direct";
    const event_id_from_front =
      typeof body?.event_id === "string" && body.event_id.trim() ? body.event_id.trim() : null;
    const utm_source = typeof body?.utm_source === "string" ? body.utm_source.trim() : "";
    const utm_medium = typeof body?.utm_medium === "string" ? body.utm_medium.trim() : "";
    const utm_campaign = typeof body?.utm_campaign === "string" ? body.utm_campaign.trim() : "";
    const utm_content = typeof body?.utm_content === "string" ? body.utm_content.trim() : "";
    // ✅ 21/08: nivel extra de atribuicao (ex.: {{placement}} do Meta no Advantage+
    // = Feed/Reels/Stories, ou {{adset.name}} se publico manual).
    const utm_term = typeof body?.utm_term === "string" ? body.utm_term.trim() : "";
    const fbclid = typeof body?.fbclid === "string" ? body.fbclid.trim() : "";
    const fbp = typeof body?.fbp === "string" ? body.fbp.trim() : "";

    // ✅ 04/08: trimestral R$47,90 → R$49,90 (já era o valor real cobrado no
    // cartão via Stripe — só o Pix/Asaas e a tela estavam desatualizados).
    const amountCents = plan === "quarterly" ? 4990 : 1790;
    const amount = amountCents / 100;
    const description = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrao";

    const userId = userData.user.id;
    const userEmail = userData.user.email || "no-email@local.invalid";

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    let userName = "Cliente DoramasPlus";
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();
      if (prof?.name) userName = prof.name;
    } catch {}

    // 1) acha ou cria o cliente no Asaas
    let customerId: string | null = null;
    try {
      const r = await fetch(`https://api.asaas.com/v3/customers?email=${encodeURIComponent(userEmail)}`, {
        headers: { access_token: asaasKey },
      });
      const d = await r.json().catch(() => ({}));
      if (d?.data?.[0]?.id) customerId = d.data[0].id;
    } catch {}

    if (!customerId) {
      const fakeCpf = generateFakeCpf();
      const r = await fetch("https://api.asaas.com/v3/customers", {
        method: "POST",
        headers: { access_token: asaasKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: userName,
          email: userEmail,
          cpfCnpj: fakeCpf,
          notificationDisabled: true,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("[asaas-create-checkout] erro criar cliente:", r.status, JSON.stringify(d));
        return json({ error: "Erro ao criar cliente no Asaas", status: r.status, details: d }, 400);
      }
      customerId = d?.id || null;
    }

    if (!customerId) {
      return json({ error: "Nao foi possivel criar/achar cliente no Asaas" }, 400);
    }

    // 2) cria a cobranca Pix
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = tomorrow.toISOString().split("T")[0];

    const order_nsu = `doramasplus|${userId}|${plan}|${Date.now()}`;

    const paymentResp = await fetch("https://api.asaas.com/v3/payments", {
      method: "POST",
      headers: { access_token: asaasKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value: amount,
        dueDate,
        description,
        externalReference: order_nsu,
      }),
    });
    const paymentData = await paymentResp.json().catch(() => ({}));
    if (!paymentResp.ok) {
      console.error("[asaas-create-checkout] erro criar cobranca:", paymentResp.status, JSON.stringify(paymentData));
      return json(
        { error: "Erro ao criar cobranca Pix (Asaas)", status: paymentResp.status, details: paymentData },
        400
      );
    }

    const paymentId = paymentData?.id;
    if (!paymentId) {
      return json({ error: "Asaas nao retornou id do pagamento", details: paymentData }, 400);
    }

    // 3) pega o QR code (imagem base64 + copia-e-cola)
    const qrResp = await fetch(`https://api.asaas.com/v3/payments/${paymentId}/pixQrCode`, {
      headers: { access_token: asaasKey },
    });
    const qrData = await qrResp.json().catch(() => ({}));
    const copyPaste = qrData?.payload || null;
    const qrImageBase64 = qrData?.encodedImage || null;

    if (!copyPaste) {
      console.error("[asaas-create-checkout] QR code vazio:", JSON.stringify(qrData));
      return json({ error: "Asaas nao retornou o codigo Pix", details: qrData }, 400);
    }

    // salva pending com UTMs/fbclid/fbp (mesma logica que a InfinitePay tinha)
    try {
      await supabaseAdmin.from("pix_payments").insert({
        user_id: userId,
        provider: "asaas",
        plan,
        amount_cents: amountCents,
        order_nsu,
        status: "pending",
        raw: paymentData,
        event_id: event_id_from_front || order_nsu,
        source,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        utm_content: utm_content || null,
        utm_term: utm_term || null,
        fbclid: fbclid || null,
        fbp: fbp || null,
      });
    } catch (e) {
      console.error("[asaas-create-checkout] falha insert pix_payments:", String(e));
    }

    return json(
      {
        order_nsu,
        event_id: event_id_from_front || order_nsu,
        payment_id: paymentId,
        qr_code_base64: qrImageBase64,
        copy_paste: copyPaste,
        amount_cents: amountCents,
        plan,
        due_date: dueDate,
      },
      200
    );
  } catch (e) {
    console.error("[asaas-create-checkout] Exception:", String(e));
    return json({ error: "Exception na Edge Function", details: String(e) }, 500);
  }
});
