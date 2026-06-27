import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const SECRET = Deno.env.get("CORRECTION_SECRET") || "dp_correction_2026";

const PHONES = [
  "558896944117",
  "556696449013",
  "5521970418693",
  "5511943660045",
  "5524999979289",
];

const PHONE_NUMBER_ID = "1162754090257667";

const SERIE_NOME = "Prefiro Morrer a te amar de Novo";
const SERIE_LINK = "https://player.mediadelivery.net/play/688480/9c52b33b-1b80-46a0-b98f-3f040fe9db69";

async function sendWA(to: string, body: string) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: text };
}

serve(async (req) => {
  const secret = new URL(req.url).searchParams.get("secret") || req.headers.get("x-secret") || "";
  if (secret !== SECRET) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  const results: any[] = [];
  for (const phone of PHONES) {
    const msg =
      `Oi! 👋 Aqui e a DoramasPlus.\n\n` +
      `Precisamos te avisar que houve um erro no nome da serie que enviamos pra voce.\n\n` +
      `✅ *O link que voce recebeu esta correto*, mas o nome certo da serie e:\n\n` +
      `🎬 *${SERIE_NOME}*\n${SERIE_LINK}\n\n` +
      `Clica no link acima pra assistir! Qualquer duvida e so chamar. 😊`;
    const r = await sendWA(phone, msg);
    results.push({ phone, ...r });
    await new Promise(res => setTimeout(res, 1000));
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
