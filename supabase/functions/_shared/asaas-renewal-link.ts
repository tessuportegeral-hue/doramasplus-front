// Gera um checkout Asaas (Pix) pro user_id/plano do lembrete de renovação,
// mesma lógica de criar-cliente-e-cobrança do asaas-create-checkout (site),
// só que sem exigir sessão logada (o cron já sabe de quem é cada lembrete).
// Substitui createInfinitepayCheckoutLink* — 30/07, InfinityPay parou de
// receber pelo link de checkout e não faz mais sentido gerar link morto.

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

export async function createAsaasCheckoutLink(
  supabase: any,
  userId: string,
  plan: "monthly" | "quarterly",
  source: string
): Promise<string | null> {
  const asaasKey = Deno.env.get("ASAAS_API_KEY") || "";
  if (!asaasKey) return null;

  const amountCents = plan === "quarterly" ? 4790 : 1790;
  const amount = amountCents / 100;
  const description = plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrao";
  const order_nsu = `doramasplus|${userId}|${plan}|${Date.now()}`;

  const { data: prof } = await supabase.from("profiles").select("name, email").eq("id", userId).maybeSingle();
  const userEmail = prof?.email || "no-email@local.invalid";
  const userName = prof?.name || "Cliente DoramasPlus";

  try {
    let customerId: string | null = null;
    try {
      const r = await fetch(`https://api.asaas.com/v3/customers?email=${encodeURIComponent(userEmail)}`, {
        headers: { access_token: asaasKey },
      });
      const d = await r.json().catch(() => ({}));
      if (d?.data?.[0]?.id) customerId = d.data[0].id;
    } catch {}

    if (!customerId) {
      const r = await fetch("https://api.asaas.com/v3/customers", {
        method: "POST",
        headers: { access_token: asaasKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: userName,
          email: userEmail,
          cpfCnpj: generateFakeCpf(),
          notificationDisabled: true,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("[asaas-renewal-link] erro criar cliente:", r.status, JSON.stringify(d));
        return null;
      }
      customerId = d?.id || null;
    }
    if (!customerId) return null;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = tomorrow.toISOString().split("T")[0];

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
    if (!paymentResp.ok || !paymentData?.invoiceUrl) {
      console.error("[asaas-renewal-link] erro criar cobranca:", paymentResp.status, JSON.stringify(paymentData));
      return null;
    }

    try {
      await supabase.from("pix_payments").insert({
        user_id: userId,
        provider: "asaas",
        plan,
        amount_cents: amountCents,
        order_nsu,
        status: "pending",
        raw: paymentData,
        event_id: order_nsu,
        source,
      });
    } catch (e) {
      console.error("[asaas-renewal-link] falha ao gravar pix_payments pending:", String(e));
    }

    return String(paymentData.invoiceUrl);
  } catch (e) {
    console.error("[asaas-renewal-link] excecao:", String(e));
    return null;
  }
}
