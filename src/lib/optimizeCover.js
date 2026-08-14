// ✅ 14/08 (LCP) — Bunny Optimizer direto na URL da CDN: as capas iam em
// tamanho cheio (o download da imagem do hero custava ~1,2s no p75 mobile,
// campo `resourceLoadDelay` da telemetria). Com width/quality na query a
// CDN serve a imagem já redimensionada — mesmo esquema já usado no ícone
// de push (192px via Bunny Optimizer). Só se aplica a *.b-cdn.net; capas
// hospedadas no Supabase Storage passam intocadas (lá não tem optimizer).
export function optimizeCover(url, width) {
  try {
    if (!url || !/\.b-cdn\.net\//.test(url) || url.includes("?")) return url;
    return `${url}?width=${width}&quality=80`;
  } catch {
    return url;
  }
}
