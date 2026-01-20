import { supabase } from '@/lib/supabaseClient';

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

export const getDoramaBySlug = async (slug) => {
  const { data, error } = await supabase
    .from('doramas')
    .select('*')
    .eq('slug', slug)
    .single();

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