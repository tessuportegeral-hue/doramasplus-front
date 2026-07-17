import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Helmet } from 'react-helmet';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Heart } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { toast } from '@/components/ui/use-toast';

// ✅ Converte as flags booleanas do dorama em lista de gêneros legíveis
function buildGenres(dorama) {
  if (!dorama) return 'Gêneros Variados';

  const genres = [];

  // Campo genres do banco (texto livre) — se existir, usa primeiro
  if (dorama.genres && dorama.genres.trim()) {
    dorama.genres.split(',').forEach(g => {
      const trimmed = g.trim();
      if (trimmed) genres.push(trimmed);
    });
  }

  // Categorias booleanas (ignorando is_featured e is_recommended que são internas)
  if (dorama.is_new) genres.push('Novo Lançamento');
  if (dorama.language === 'dublado') genres.push('Dublado');
  if (dorama.is_baby_pregnancy) genres.push('Bebês e Gravidezes');
  if (dorama.is_taboo_relationship) genres.push('Relacionamento Tabu');
  if (dorama.is_hidden_identity) genres.push('Identidade Escondida');

  if (genres.length === 0) return 'Gêneros Variados';

  // Remove duplicatas
  return [...new Set(genres)].join(', ');
}

export default function DoramaDetail() {
  const { id: slugFromUrl } = useParams();
  const navigate = useNavigate();

  const [dorama, setDorama] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const { isAuthenticated } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = dorama ? isFavorite(dorama.id) : false;

  const handleToggleFavorite = async () => {
    if (!isAuthenticated) {
      toast({
        title: 'Faça login para favoritar',
        description: 'Entre na sua conta para salvar doramas nos favoritos.',
      });
      return;
    }

    const ok = await toggleFavorite(dorama.id);
    if (!ok) {
      toast({
        title: 'Não foi possível atualizar os favoritos',
        description: 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'PageView');
      }
    } catch (e) {
      console.error('[pixel] PageView DoramaDetail error:', e);
    }
  }, [slugFromUrl]);

  useEffect(() => {
    const fetchDorama = async () => {
      try {
        if (!slugFromUrl) {
          setError(true);
          setLoading(false);
          return;
        }

        const normalizedSlug = decodeURIComponent(slugFromUrl).trim().toLowerCase();

        // maybeSingle (não single): com 0 linhas, single() retorna ERRO
        // (PGRST116) em vez de data:null, o que pulava a checagem de
        // slug_redirects logo abaixo e caía direto em "não encontrado".
        const { data, error: queryError } = await supabase
          .from('doramas')
          .select('*')
          .eq('slug', normalizedSlug)
          .maybeSingle();

        if (queryError) {
          console.error('Supabase error:', queryError);
          setError(true);
        } else if (!data) {
          console.warn('No dorama found for slug:', normalizedSlug);
          // Fallback client-side: em produção o middleware.js já resolve isso
          // com 301 real antes do React nem carregar, mas em dev local
          // (`vite dev` não roda o middleware do Vercel) e como defesa em
          // profundidade, confere aqui também se é um slug antigo renomeado.
          const { data: redirectRow } = await supabase
            .from('slug_redirects')
            .select('new_slug')
            .eq('old_slug', normalizedSlug)
            .maybeSingle();

          if (redirectRow?.new_slug) {
            navigate(`/dorama/${redirectRow.new_slug}`, { replace: true });
            return;
          }
          setError(true);
        } else {
          setDorama(data);
        }
      } catch (err) {
        console.error('Unexpected error:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchDorama();
  }, [slugFromUrl]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 pb-12 animate-pulse">
        <div className="container mx-auto px-4 py-6">
          <div className="h-9 w-40 bg-slate-900 rounded mb-4" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <div className="md:col-span-1 space-y-6">
              <div className="aspect-[2/3] rounded-2xl border border-slate-800 max-w-sm mx-auto bg-slate-900" />
              <div className="h-14 w-full bg-slate-900 rounded-md" />
            </div>

            <div className="md:col-span-2 space-y-8">
              <div className="space-y-2">
                <div className="h-9 w-3/4 bg-slate-900 rounded" />
                <div className="h-5 w-1/2 bg-slate-900 rounded" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-full bg-slate-900 rounded" />
                <div className="h-4 w-full bg-slate-900 rounded" />
                <div className="h-4 w-2/3 bg-slate-900 rounded" />
              </div>
              <div className="h-40 w-full bg-slate-900/50 rounded-xl border border-slate-800/50" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !dorama) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white gap-4 p-4">
        <Helmet>
          <meta name="robots" content="noindex" />
        </Helmet>
        <h2 className="text-xl font-semibold text-red-400">Dorama não encontrado</h2>
        <p className="text-slate-400 text-center max-w-md">
          Não foi possível encontrar o dorama "{slugFromUrl}". Ele pode ter sido removido ou o link está incorreto.
        </p>
        <Button
          onClick={() => navigate('/dashboard')}
          variant="outline"
          className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-200"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar para o Início
        </Button>
      </div>
    );
  }

  const displayGenres = buildGenres(dorama);

  return (
    <>
      <Helmet>
        <title>{dorama.title ? `${dorama.title} - Detalhes` : 'Detalhes do Dorama'}</title>
        <meta name="description" content={dorama.description || 'Assista doramas online no DoramaStream.'} />
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 pb-12">
        <div className="container mx-auto px-4 py-6">
          <Button
            onClick={() => navigate('/dashboard')}
            variant="ghost"
            className="text-slate-400 hover:text-white hover:bg-slate-900 mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" /> Voltar ao Início
          </Button>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            {/* Left Column: Poster and Watch Button */}
            <div className="md:col-span-1 space-y-6">
              {dorama.cover_url && (
                <div className="aspect-[2/3] rounded-2xl overflow-hidden border border-slate-800 shadow-lg max-w-sm mx-auto bg-slate-900">
                  <img
                    src={dorama.cover_url}
                    alt={`Capa de ${dorama.title}`}
                    width={400}
                    height={600}
                    fetchpriority="high"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <Button
                onClick={() => navigate(`/dorama/${slugFromUrl}/watch`)}
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-bold py-6"
              >
                <Play className="w-6 h-6 mr-3" />
                Assistir agora
              </Button>

              <Button
                onClick={handleToggleFavorite}
                variant="outline"
                size="lg"
                className={`w-full py-6 border-slate-700 ${
                  favorited
                    ? 'text-red-400 border-red-500/40 hover:bg-red-500/10'
                    : 'text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Heart className={`w-5 h-5 mr-2 ${favorited ? 'fill-red-500 text-red-500' : ''}`} />
                {favorited ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              </Button>
            </div>

            {/* Right Column: Info and Details */}
            <div className="md:col-span-2 space-y-8">
              <div className="space-y-2">
                <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                  {dorama.title}
                </h1>
                <div className="flex items-center gap-3 text-slate-400 text-base flex-wrap">
                  <span>{dorama.release_year || 'Ano N/A'}</span>
                  <span className="w-1.5 h-1.5 bg-slate-600 rounded-full" />
                  <span>{displayGenres}</span>
                </div>
              </div>

              <div className="prose prose-invert max-w-none">
                <h3 className="text-xl font-semibold text-white mb-3">Sinopse</h3>
                <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                  {dorama.description || "Nenhuma descrição disponível."}
                </p>
              </div>

              <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800/50">
                <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Detalhes</h4>
                <dl className="space-y-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Título Original</dt>
                    <dd className="text-slate-200 font-medium">{dorama.title}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Gênero</dt>
                    <dd className="text-slate-200">{displayGenres}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Lançamento</dt>
                    <dd className="text-slate-200">{dorama.release_year || '-'}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
