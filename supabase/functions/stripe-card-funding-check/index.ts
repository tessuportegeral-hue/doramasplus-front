// Diagnóstico pontual (23/07/2026): checar se assinantes Stripe estão pagando
// em débito ou crédito, e cruzar com o status (active/past_due/canceled) pra
// avaliar se débito tem taxa de falha maior em cobrança recorrente no Brasil.
// Não mexe em nada, só lê. Pode ser removida depois de usada.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "npm:stripe@14.19.0";
import { createClient } from "npm:@supabase/supabase-js@2.33.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CHECK_SECRET = "dp_card_funding_x9k2m4";

const stripe = new Stripe(STRIPE_SECRET_KEY!, { apiVersion: "2023-08-16" });
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function resolveFunding(stripeSub: Stripe.Subscription) {
  try {
    let pm: Stripe.PaymentMethod | null = null;

    if (stripeSub.default_payment_method) {
      pm =
        typeof stripeSub.default_payment_method === "string"
          ? await stripe.paymentMethods.retrieve(stripeSub.default_payment_method)
          : (stripeSub.default_payment_method as Stripe.PaymentMethod);
    } else {
      const customerId =
        typeof stripeSub.customer === "string" ? stripeSub.customer : stripeSub.customer.id;
      const customer = await stripe.customers.retrieve(customerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (!("deleted" in customer) || !customer.deleted) {
        const dpm = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
        if (dpm) {
          pm = typeof dpm === "string" ? await stripe.paymentMethods.retrieve(dpm) : (dpm as Stripe.PaymentMethod);
        }
      }
    }

    if (!pm || pm.type !== "card" || !pm.card) {
      return { funding: "unknown", brand: null, last4: null };
    }
    return { funding: pm.card.funding, brand: pm.card.brand, last4: pm.card.last4 };
  } catch (e: any) {
    return { funding: "check_failed", brand: null, last4: null, error: String(e?.message ?? e) };
  }
}

serve(async (req) => {
  if (req.headers.get("x-check-secret") !== CHECK_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("id, user_id, status, stripe_subscription_id")
      .not("stripe_subscription_id", "is", null);

    if (error) {
      return new Response(JSON.stringify({ error: "query_failed", details: error }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = subs ?? [];
    const userIds = rows.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    const emailById = new Map((profiles ?? []).map((p: any) => [p.id, p.email]));

    const results: any[] = [];

    for (const batch of chunk(rows, 8)) {
      await Promise.all(
        batch.map(async (sub) => {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
              expand: ["default_payment_method"],
            });
            const funding = await resolveFunding(stripeSub);
            results.push({
              email: emailById.get(sub.user_id) ?? null,
              db_status: sub.status,
              stripe_status: stripeSub.status,
              ...funding,
            });
          } catch (e: any) {
            results.push({
              email: emailById.get(sub.user_id) ?? null,
              db_status: sub.status,
              stripe_status: "retrieve_failed",
              funding: "check_failed",
              error: String(e?.message ?? e),
            });
          }
        })
      );
    }

    const summary: Record<string, Record<string, number>> = {};
    for (const r of results) {
      const key = r.stripe_status ?? "unknown";
      summary[key] = summary[key] ?? {};
      summary[key][r.funding] = (summary[key][r.funding] ?? 0) + 1;
    }

    return new Response(
      JSON.stringify({ ok: true, total: results.length, summary, results }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "internal", details: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
