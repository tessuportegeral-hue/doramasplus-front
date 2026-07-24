// Diagnóstico pontual (23/07): pra cada email de uma lista de contas com
// stripe_subscription_id "órfão" (conta Stripe antiga cancelada), busca na
// conta Stripe ATUAL se existe cliente com esse email e, se existir, se ele
// tem alguma assinatura lá — pra confirmar se a pessoa pagou de novo na
// conta nova sem ficar vinculada certo, ou se realmente não renovou.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@14.19.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const CHECK_SECRET = "dp_check_new_acct_r7m2";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-08-16" });

Deno.serve(async (req) => {
  if (req.headers.get("x-check-secret") !== CHECK_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const userIds: string[] = Array.isArray(body?.user_ids) ? body.user_ids : [];
  if (!userIds.length) {
    return new Response(JSON.stringify({ error: "missing user_ids" }), { status: 400 });
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, stripe_customer_id")
    .in("id", userIds);

  const results = [];

  for (const p of profiles ?? []) {
    const entry: any = { user_id: p.id, email: p.email, stripe_customer_id_on_file: p.stripe_customer_id };

    // 1) O stripe_customer_id que já está gravado existe na conta atual?
    if (p.stripe_customer_id) {
      try {
        const cust = await stripe.customers.retrieve(p.stripe_customer_id);
        entry.customer_on_file_exists_in_current_account = !("deleted" in cust && cust.deleted);
      } catch {
        entry.customer_on_file_exists_in_current_account = false;
      }
    } else {
      entry.customer_on_file_exists_in_current_account = null;
    }

    // 2) Existe algum cliente com esse email na conta atual (pode ser outro customer_id)?
    if (p.email) {
      try {
        const search = await stripe.customers.list({ email: p.email, limit: 5 });
        entry.customers_found_by_email = search.data.map((c) => c.id);

        // 3) Pra cada customer achado, tem assinatura (qualquer status)?
        const subsByCustomer: Record<string, any[]> = {};
        for (const c of search.data) {
          const subs = await stripe.subscriptions.list({ customer: c.id, limit: 5, status: "all" });
          subsByCustomer[c.id] = subs.data.map((s) => ({ id: s.id, status: s.status, current_period_end: s.current_period_end }));
        }
        entry.subscriptions_by_customer = subsByCustomer;
      } catch (e: any) {
        entry.email_search_error = String(e?.message ?? e);
      }
    }

    results.push(entry);
  }

  return new Response(JSON.stringify({ ok: true, results }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
