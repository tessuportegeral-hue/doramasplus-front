import Stripe from "stripe";

// Note: This file is intended for server-side use (e.g., Supabase Edge Functions)
// Do not import this file in client-side components as it requires the STRIPE_SECRET_KEY
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});