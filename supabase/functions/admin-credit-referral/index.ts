import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditReferralIfEligible, resolvePendingReferralsForReferrer, type PendingResolveResult } from "../_shared/referral.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const headers = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const body = await req.json().catch(() => ({}));
    const referredId = String(body?.referred_id || body?.user_id || "").trim();

    if (!referredId) {
      return json(400, { ok: false, error: "missing_referred_id" });
    }

    const result = await creditReferralIfEligible(supabase, referredId);

    // esse mesmo usuário pode ser indicador de alguém com referral 'pending'
    let pendingResult: PendingResolveResult = { resolved: 0 };
    try {
      pendingResult = await resolvePendingReferralsForReferrer(supabase, referredId);
    } catch (e) {
      console.error("[referral] excecao ao resolver pending:", e);
    }

    return json(200, { ok: true, result, pending_resolved: pendingResult.resolved });
  } catch (e) {
    console.error("[admin-credit-referral] fatal:", e);
    return json(500, { ok: false, error: "fatal" });
  }
});
