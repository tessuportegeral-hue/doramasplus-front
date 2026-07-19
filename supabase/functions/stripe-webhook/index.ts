// stripe-webhook edge function (Deno runtime)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "npm:stripe@14.19.0";
import { createClient } from "npm:@supabase/supabase-js@2.33.0";
import { creditReferralIfEligible, resolvePendingReferralsForReferrer } from "../_shared/referral.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!STRIPE_SECRET_KEY) console.error("Missing STRIPE_SECRET_KEY env var");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
  console.error("Missing Supabase env vars");

const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2023-08-16" });
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

// ====== META CAPI (Purchase) ======
const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "";
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") ?? "";
const META_TEST_EVENT_CODE = Deno.env.get("META_TEST_EVENT_CODE") ?? ""; // deixe vazio em produção

async function sha256Hex(input: string) {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendMetaPurchase(opts: {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
  eventId: string;
  eventTimeUnix: number;
  value: number;
  currency: "BRL";
  contentName: string;
  userEmail?: string | null;
}): Promise<boolean> {
  try {
    const {
      pixelId,
      accessToken,
      testEventCode,
      eventId,
      eventTimeUnix,
      value,
      currency,
      contentName,
      userEmail,
    } = opts;

    let em: string[] | undefined = undefined;
    if (userEmail) {
      const normalized = userEmail.trim().toLowerCase();
      if (normalized) em = [await sha256Hex(normalized)];
    }

    const payload: any = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTimeUnix,
          event_id: eventId,
          action_source: "website",
          user_data: em ? { em } : {},
          custom_data: {
            currency,
            value,
            content_name: contentName,
          },
        },
      ],
    };

    if (testEventCode) payload.test_event_code = testEventCode;

    const resp = await fetch(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(
        pixelId
      )}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("META CAPI ERROR:", resp.status, t);
      return false;
    } else {
      const j = await resp.json().catch(() => ({}));
      console.log("META CAPI OK:", j);
      return true;
    }
  } catch (e) {
    console.error("META CAPI EXCEPTION:", e);
    return false;
  }
}

function mapPlanFromPriceId(priceId: string | null) {
  if (!priceId) return { planName: "Assinatura", interval: "month" as const };

  if (
    priceId.includes("TRIM") ||
    priceId.includes("quarter") ||
    priceId.includes("QUART")
  ) {
    return { planName: "DoramasPlus Trimestral", interval: "quarter" as const };
  }
  return { planName: "DoramasPlus Padrão", interval: "month" as const };
}

// ====== WEBHOOK ======
serve(async (req) => {
  try {
    const body = new Uint8Array(await req.arrayBuffer());
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      console.error("Missing stripe-signature header");
      return new Response("Missing stripe-signature", { status: 400 });
    }

    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("Missing STRIPE_WEBHOOK_SECRET env var");
      return new Response("Missing webhook secret", { status: 500 });
    }

    let event: Stripe.Event;
    try {
      // @ts-ignore
      event = await (stripe.webhooks.constructEventAsync
        ? stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
        : stripe.webhooks.constructEvent(body, signature, webhookSecret));
    } catch (err) {
      console.error("Webhook signature verification failed.", err);
      return new Response("Webhook signature verification failed", {
        status: 400,
      });
    }

    const type = event.type;
    console.info(`Received event: ${type}`);

    // ---------------- HELPERS ----------------
    async function ensureProfileFromSession(session: Stripe.Checkout.Session) {
      const customerId = session.customer as string | null;
      const customerEmail =
        session.customer_details?.email ?? session.customer_email ?? null;

      const userId = (session.metadata as any)?.user_id;

      if (!userId) {
        console.warn("checkout.session.completed sem metadata.user_id");
        return null;
      }

      const { data: existingProfile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        console.error("Erro ao buscar profile:", profileError);
        return null;
      }

      if (existingProfile) {
        if (customerId && existingProfile.stripe_customer_id !== customerId) {
          const { error: updateError } = await supabase
            .from("profiles")
            .update({ stripe_customer_id: customerId })
            .eq("id", userId);

          if (updateError) {
            console.error(
              "Erro ao atualizar stripe_customer_id em profiles:",
              updateError
            );
          }
        }
        return existingProfile.id;
      }

      const { data: newProfile, error: insertError } = await supabase
        .from("profiles")
        .insert({
          id: userId,
          email: customerEmail,
          stripe_customer_id: customerId,
        })
        .select("*")
        .single();

      if (insertError) {
        console.error("Erro ao criar profile:", insertError);
        return null;
      }

      return newProfile.id;
    }

    async function upsertSubscriptionFromStripe(
      stripeSub: Stripe.Subscription,
      userId?: string | null
    ) {
      let finalUserId: string | null = userId ?? null;

      // fallback: achar userId pelo stripe_customer_id
      if (!finalUserId && stripeSub.customer) {
        const customerId =
          typeof stripeSub.customer === "string"
            ? stripeSub.customer
            : stripeSub.customer.id;

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (error)
          console.error("Erro ao buscar profile por stripe_customer_id:", error);
        if (profile) finalUserId = profile.id;
      }

      if (!finalUserId) {
        console.warn(
          "Stripe sub sem user_id resolvido. Ignorando upsert:",
          stripeSub.id
        );
        return;
      }

      const item = stripeSub.items?.data?.[0];
      const priceId = item?.price?.id ?? null;

      // Stripe vem migrando current_period_start/end do nível da subscription pro
      // nível do item (subscription.items.data[].current_period_*). Se o campo top-level
      // vier ausente, cai pro item — senão end_at grava NULO e o gate de premium
      // (que só libera acesso sem data para provider=null) fica sem base pra confiar.
      const rawPeriodStart =
        stripeSub.current_period_start ?? (item as any)?.current_period_start ?? null;
      const rawPeriodEnd =
        stripeSub.current_period_end ?? (item as any)?.current_period_end ?? null;

      const currentPeriodStart = rawPeriodStart
        ? new Date(rawPeriodStart * 1000).toISOString()
        : null;

      const currentPeriodEnd = rawPeriodEnd
        ? new Date(rawPeriodEnd * 1000).toISOString()
        : null;

      const payload: any = {
        user_id: finalUserId,
        type: "stripe",
        // Stripe é sempre provider=null (auto-renovável, controlado pelo status).
        // Sem isso, uma conta com histórico de PIX/manual fica com provider antigo
        // "preso" mesmo após renovar de verdade no Stripe, e o gate nega acesso.
        provider: null,
        source: "stripe",
        stripe_subscription_id: stripeSub.id,
        status: stripeSub.status,
        price_id: priceId,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        start_at: currentPeriodStart,
        end_at: currentPeriodEnd,
        last_renewed_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("subscriptions")
        .upsert(payload, { onConflict: "user_id" });

      if (upsertError) {
        console.error("Erro ao upsert subscriptions:", upsertError);
      } else {
        console.log(
          "Subscription upsert OK (by user_id):",
          stripeSub.id,
          "user:",
          finalUserId
        );
      }
    }

    async function resolveUserIdAndEmailFromCustomer(customerId: string) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id,email,meta_purchase_sent")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      return {
        userId: profile?.id ?? null,
        email: profile?.email ?? null,
        meta_purchase_sent: (profile as any)?.meta_purchase_sent ?? false,
      };
    }

    // ✅ PURCHASE VERDADEIRO = PRIMEIRA COBRANÇA PAGA (não renovação)
    async function handleInvoicePaid(
      invoice: Stripe.Invoice,
      stripeEventId: string
    ) {
      try {
        // 1) Só dispara se tiver pago de verdade
        const amountPaid = invoice.amount_paid ?? 0;
        if (!amountPaid || amountPaid <= 0) {
          console.log("invoice.paid com amount_paid=0 (skip):", invoice.id);
          return;
        }

        // 2) Só a PRIMEIRA cobrança da assinatura
        // subscription_create = primeira compra
        // subscription_cycle  = renovação
        const billingReason = (invoice as any)?.billing_reason ?? "";
        if (billingReason !== "subscription_create") {
          console.log(
            "invoice.paid ignorado (não é purchase verdadeiro):",
            invoice.id,
            "billing_reason=",
            billingReason
          );
          return;
        }

        // 3) Resolver customerId
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;

        if (!customerId) {
          console.warn("invoice.paid sem customer:", invoice.id);
          return;
        }

        // 4) Puxa userId/email + trava do banco
        const { userId, email, meta_purchase_sent } =
          await resolveUserIdAndEmailFromCustomer(customerId);

        if (!userId) {
          console.warn(
            "invoice.paid: não consegui resolver user_id pelo customer:",
            customerId
          );
          return;
        }

        // 4.5) Referral — credita indicação na primeira cobrança paga real
        // (independente da trava de Meta CAPI abaixo, que é outra coisa)
        try {
          const referralResult = await creditReferralIfEligible(supabase, userId);
          console.log("[referral] resultado:", JSON.stringify(referralResult));
        } catch (e) {
          console.error("[referral] excecao:", e);
        }

        // 4.6) Referral — este usuário acabou de pagar: se ele próprio for
        // indicador de alguém com referral 'pending', credita agora.
        try {
          const pendingResult = await resolvePendingReferralsForReferrer(supabase, userId);
          if (pendingResult.resolved > 0) {
            console.log("[referral] pending resolvidos:", pendingResult.resolved, "para", userId);
          }
        } catch (e) {
          console.error("[referral] excecao ao resolver pending:", e);
        }

        // 5) Trava definitiva: se já enviou uma vez, nunca mais manda
        if (meta_purchase_sent === true) {
          console.log("Purchase já enviado anteriormente (bloqueado):", userId);
          return;
        }

        // 6) plano (opcional)
        const priceId = invoice.lines?.data?.[0]?.price?.id ?? null;
        const { planName } = mapPlanFromPriceId(priceId);

        // 7) Envia pro Meta (dedup perfeito usando o ID do evento do Stripe)
        if (META_PIXEL_ID && META_ACCESS_TOKEN) {
          const ok = await sendMetaPurchase({
            pixelId: META_PIXEL_ID,
            accessToken: META_ACCESS_TOKEN,
            testEventCode: META_TEST_EVENT_CODE
              ? META_TEST_EVENT_CODE
              : undefined,
            eventId: `stripe_${stripeEventId}`, // dedup perfeito
            eventTimeUnix: Math.floor(Date.now() / 1000),
            value: amountPaid / 100,
            currency: "BRL",
            contentName: planName,
            userEmail: email,
          });

          if (ok) {
            // 8) Marca como enviado (trava)
            await supabase
              .from("profiles")
              .update({ meta_purchase_sent: true })
              .eq("id", userId);
            console.log("Purchase VERDADEIRO enviado ao Meta:", userId);
          } else {
            console.error("Meta CAPI falhou para invoice:", invoice.id);
          }
        } else {
          console.log(
            "META CAPI: pulado (META_PIXEL_ID/META_ACCESS_TOKEN ausentes)"
          );
        }
      } catch (e) {
        console.error("Erro em handleInvoicePaid:", e);
      }
    }

    // ------------- EVENT HANDLERS ----------------
    async function handleCheckoutSessionCompleted(
      session: Stripe.Checkout.Session
    ) {
      try {
        console.log("Checkout session completed:", session.id);

        const userId = await ensureProfileFromSession(session);
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;

          const stripeSub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionFromStripe(stripeSub, userId);
        }
      } catch (e) {
        console.error("Erro em session.completed:", e);
      }
    }

    async function handleSubscriptionCreatedOrUpdated(sub: Stripe.Subscription) {
      try {
        const stripeSub = sub;
        console.log(
          "handleSubscriptionCreatedOrUpdated:",
          stripeSub.id,
          stripeSub.status
        );
        await upsertSubscriptionFromStripe(stripeSub);
      } catch (e) {
        console.error("Erro em subscription.created/updated:", e);
      }
    }

    async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
      try {
        const stripeSub = sub;
        console.log("handleSubscriptionDeleted:", stripeSub.id);

        const { error } = await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            end_at: new Date().toISOString(),
            current_period_end: new Date().toISOString(),
            last_renewed_at: new Date().toISOString(),
          })
          .eq(
            "user_id",
            await (async () => {
              const customerId =
                typeof stripeSub.customer === "string"
                  ? stripeSub.customer
                  : stripeSub.customer.id;

              const { data: profile } = await supabase
                .from("profiles")
                .select("id")
                .eq("stripe_customer_id", customerId)
                .maybeSingle();

              return profile?.id ?? null;
            })()
          )
          .not("user_id", "is", null);

        if (error) {
          console.error("Erro ao marcar subscription como cancelada:", error);
        }
      } catch (e) {
        console.error("Erro em subscription.deleted:", e);
      }
    }

    // ------------- DISPATCH ----------------
    switch (type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session
        );
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionCreatedOrUpdated(
          event.data.object as Stripe.Subscription
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      // ✅ COMPRA REAL: só primeira cobrança paga (invoice.paid + subscription_create + trava no profile)
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, event.id);
        break;

      default:
        console.info("Unhandled event:", type);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
