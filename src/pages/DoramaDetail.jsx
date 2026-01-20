import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Helmet } from 'react-helmet';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play } from 'lucide-react';

export default function DoramaDetail() {
  const { id: slugFromUrl } = useParams();
  const navigate = useNavigate();

  const [dorama, setDorama] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchDorama = async () => {
      try {
        if (!slugFromUrl) {
          setError(true);
          setLoading(false);
          return;
        }

        const normalizedSlug = decodeURIComponent(slugFromUrl).trim().toLowerCase();

        const { data, error: queryError } = await supabase
          .from('doramas')
          .select('*')
          .eq('slug', normalizedSlug)
          .single();

        if (queryError) {
          console.error('Supabase error:', queryError);
          setError(true);
        } else if (!data) {
          console.warn('No dorama found for slug:', normalizedSlug);
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="animate-pulse">Carregando dorama...</div>
      </div>
    );
  }

  if (error || !dorama) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white gap-4 p-4">
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
                <div className="rounded-2xl overflow-hidden border border-slate-800 shadow-lg max-w-sm mx-auto">
                  <img
                    src={dorama.cover_url}
                    alt={`Capa de ${dorama.title}`}
                    className="w-full h-auto object-cover"
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
            </div>

            {/* Right Column: Info and Details */}
            <div className="md:col-span-2 space-y-8">
              <div className="space-y-2">
                <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                  {dorama.title}
                </h1>
                <div className="flex items-center gap-3 text-slate-400 text-base">
                  <span>{dorama.release_year || 'Ano N/A'}</span>
                  <span className="w-1.5 h-1.5 bg-slate-600 rounded-full" />
                  <span>{dorama.genres || 'Gêneros Variados'}</span>
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
                    <dd className="text-slate-200">{dorama.genres || '-'}</dd>
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