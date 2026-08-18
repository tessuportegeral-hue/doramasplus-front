import { supabase } from '@/lib/customSupabaseClient';

// ✅ 17/08/2026 — lookup de dorama por slug via RPC (POST), NÃO via
// `.from('doramas').eq('slug', ...)` (GET).
//
// Motivo (provado nos logs do Supabase): o renderizador do Google (WRS)
// reescreve números que parecem timestamp dentro da query string de GETs
// pra bater mais no cache dele — `slug=eq.a-ira-do-guerreiro-1786703290`
// chegava no PostgREST como `slug=eq.a-ira-do-guerreiro-1785888000`
// (05/08/2026 00:00 UTC), a consulta voltava vazia e a página real virava
// "Dorama não encontrado" + noindex (568 páginas no Search Console em
// 15/08). Todo slug do bot termina em timestamp, então TODO dorama novo
// nascia desindexado. O preflight OPTIONS ia com o número certo — só o
// GET era reescrito. POST (rpc) não passa por essa normalização.
//
// Retorno no mesmo formato de `.maybeSingle()`: { data: row|null, error }.
export async function fetchDoramaBySlug(slug) {
  const { data, error } = await supabase.rpc('get_dorama_by_slug', { p_slug: slug });
  if (error) return { data: null, error };
  return { data: Array.isArray(data) && data.length > 0 ? data[0] : null, error: null };
}

// Mesma proteção pro fallback de slug antigo (slug_redirects).
export async function fetchSlugRedirect(slug) {
  const { data, error } = await supabase.rpc('get_slug_redirect', { p_slug: slug });
  if (error) return { data: null, error };
  return { data: typeof data === 'string' && data ? data : null, error: null };
}
