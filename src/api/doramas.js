import { supabase } from '@/lib/supabaseClient';
import { fetchDoramaBySlug } from '@/lib/doramaLookup';

export const getAllDoramas = async () => {
  const { data, error } = await supabase
    .from('doramas')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching doramas:', error);
    throw error;
  }
  return data;
};

// ✅ 21/08 — busca por slug DELEGA pro lookup via RPC/POST (ver
// src/lib/doramaLookup.js). NÃO usar `.from('doramas').eq('slug', ...)` (GET):
// o renderizador do Google reescreve o número no fim do slug na query string
// e a página real vira "não encontrado" + noindex. Esta função estava morta
// (ninguém importava), mas ficava como mina — se alguém a usasse numa página
// nova, o bug voltaria silencioso. Agora nasce segura.
export const getDoramaBySlug = async (slug) => {
  const { data, error } = await fetchDoramaBySlug(slug);
  if (error) {
    console.error('Error fetching dorama by slug:', error);
    throw error;
  }
  return data;
};

export const getRecentDoramas = async (limit = 6) => {
  const { data, error } = await supabase
    .from('doramas')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching recent doramas:', error);
    throw error;
  }
  return data;
};