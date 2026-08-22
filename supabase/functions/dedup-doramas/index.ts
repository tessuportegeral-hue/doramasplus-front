// dedup-doramas: acha doramas duplicados (mesmo título normalizado), CONFIRMA com
// Claude Vision que as capas são o mesmo dorama, e então:
//  - mesmo idioma  -> apaga o mais novo como duplicado (mantém o mais antigo)
//  - idioma difer. -> copia o vídeo do novo pro campo alt_ do antigo (áudio alt) e apaga o novo
//  - Vision NÃO confirma -> não mexe (só loga)
// Modo 'report' só simula (não altera nada). Modo 'apply' executa.
// Auth: body.secret == DEDUP_SECRET. Agendável a cada 4h.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const DEDUP_SECRET = Deno.env.get("DEDUP_SECRET") ?? "";
const VISION_MODEL = "claude-haiku-4-5-20251001";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

async function fetchB64(url: string): Promise<{ data: string; mt: string } | null> {
  try {
    const r = await fetch(url, { headers: { Referer: "https://doramasplus.com.br/" } });
    if (!r.ok) return null;
    let mt = r.headers.get("content-type") || "image/jpeg";
    if (!mt.startsWith("image/")) mt = "image/jpeg";
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
    return { data: btoa(bin), mt };
  } catch { return null; }
}

async function visionMesmo(coverA: string, coverB: string, titulo: string): Promise<{ mesmo: boolean; motivo: string } | null> {
  if (!ANTHROPIC_KEY || !coverA || !coverB) return null;
  const [a, b] = await Promise.all([fetchB64(coverA), fetchB64(coverB)]);
  if (!a || !b) return null; // não conseguiu as capas -> não confirma (seguro)
  const body = {
    model: VISION_MODEL,
    max_tokens: 200,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "CAPA 1:" },
        { type: "image", source: { type: "base64", media_type: a.mt, data: a.data } },
        { type: "text", text: "CAPA 2:" },
        { type: "image", source: { type: "base64", media_type: b.mt, data: b.data } },
        { type: "text", text: `Essas duas capas são do MESMO dorama (mesma história, mesma arte/personagens/cena)? IGNORE selos de idioma (DUBLADO/LEGENDADO) e logos de plataforma (DramaBox, etc). Título em texto: "${titulo}". Responda SÓ um JSON: {"mesmo": true|false, "motivo": "curto"}` },
      ],
    }],
  };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    const txt = d?.content?.find((c: any) => c.type === "text")?.text || "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]);
    return { mesmo: !!o.mesmo, motivo: String(o.motivo || "").slice(0, 200) };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (String(body?.secret || "") !== DEDUP_SECRET || !DEDUP_SECRET) return json({ error: "forbidden" }, 403);
    const modo = body?.modo === "apply" ? "apply" : "report";
    const limite = Math.min(Number(body?.limite) || 50, 100);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: linhas, error } = await admin.rpc("dedup_grupos");
    if (error) throw new Error("dedup_grupos: " + error.message);

    // agrupa por titulo_norm
    const grupos: Record<string, any[]> = {};
    for (const r of linhas || []) (grupos[r.titulo_norm] ||= []).push(r);

    const resultados: any[] = [];
    const logs: any[] = [];
    let feitos = 0;

    for (const tn of Object.keys(grupos)) {
      if (feitos >= limite) break;
      const membros = grupos[tn].sort((a, b) => (a.rnk - b.rnk));
      const antigo = membros[0]; // rnk 1 = mais antigo = mantido
      for (let k = 1; k < membros.length; k++) {
        if (feitos >= limite) break;
        const novo = membros[k]; // candidato a remover
        feitos++;
        const v = await visionMesmo(antigo.cover_url, novo.cover_url, novo.title);
        const base = {
          titulo_norm: tn, mantido_sc: antigo.short_code, removido_sc: novo.short_code,
          idiomas: `${antigo.language} + ${novo.language}`,
          vision_mesmo: v?.mesmo ?? null, vision_motivo: v?.motivo ?? "vision indisponivel/sem capa",
        };
        let acao: string;
        let detalhe: any = {};
        if (!v || !v.mesmo) {
          acao = "pulou_capa_diferente";
        } else if (antigo.language === novo.language) {
          acao = "apagar_mesmo_idioma";
          if (modo === "apply") {
            const { data: res, error: e2 } = await admin.rpc("dedup_merge_dorama",
              { p_dup: novo.id, p_tgt: antigo.id, p_copiar_alt: false });
            if (e2) { acao = "erro"; detalhe = { erro: e2.message }; } else detalhe = res;
          }
        } else if (!antigo.alt_bunny_url) {
          acao = "audio_alt";
          if (modo === "apply") {
            const { data: res, error: e2 } = await admin.rpc("dedup_merge_dorama",
              { p_dup: novo.id, p_tgt: antigo.id, p_copiar_alt: true });
            if (e2) { acao = "erro"; detalhe = { erro: e2.message }; } else detalhe = res;
          }
        } else {
          acao = "pulou_ja_tem_alt";
        }
        const linha = { modo, acao, ...base, detalhe };
        resultados.push(linha);
        logs.push({ modo, acao, titulo_norm: tn, mantido_sc: antigo.short_code, removido_sc: novo.short_code,
                    idiomas: base.idiomas, vision_mesmo: base.vision_mesmo, vision_motivo: base.vision_motivo, detalhe });
      }
    }

    if (logs.length) await admin.from("dorama_dedup_log").insert(logs);

    const resumo: Record<string, number> = {};
    for (const r of resultados) resumo[r.acao] = (resumo[r.acao] || 0) + 1;

    return json({ ok: true, modo, pares_analisados: resultados.length, resumo, resultados });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
