// ✅ 12/08 — link do Play Store com etiqueta de origem (install referrer).
// O Play Console agrega instalações por utm_source/utm_medium, então dá pra
// saber QUAL convite converte de verdade (banner do assinante, carrossel,
// rodapé, atalho antigo...) e dobrar a aposta no que funciona.
// O valor de `referrer` precisa ir URL-encoded dentro da URL da loja.
const BASE = "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";

export function playStoreUrl(medium) {
  if (!medium) return BASE;
  const referrer = encodeURIComponent(`utm_source=doramasplus&utm_medium=${medium}`);
  return `${BASE}&referrer=${referrer}`;
}
