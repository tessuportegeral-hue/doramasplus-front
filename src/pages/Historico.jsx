import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { History as HistoryIcon, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/Navbar';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';

// ✅ 07/08 — TESTE: substitui "Continuar Assistindo" do Dashboard por uma
// aba própria, gateada pro tesagencia@gmail.com (ver BottomNav.jsx). Mostra
// os últimos 20 doramas distintos com progresso salvo.
const HISTORY_LIMIT = 20;
const BOTTOM_NAV_TEST_EMAIL = 'tesagencia@gmail.com';

export default function Historico() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const showBottomPadding = user?.email === BOTTOM_NAV_TEST_EMAIL;

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }

    let isCancelled = false;

    const loadHistory = async () => {
      setLoading(true);
      setError(false);
      try {
        // Busca mais linhas do que o limite final porque várias linhas de
        // watch_history podem apontar pro mesmo dorama_id (episódios
        // diferentes) — depois de deduplicar sobra menos que isso.
        const { data: history, error: historyError } = await supabase
          .from('watch_history')
          .select('dorama_id,episode,current_time,duration,finished,updated_at')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(60);

        if (historyError) throw historyError;

        if (!history || history.length === 0) {
          if (!isCancelled) setItems([]);
          return;
        }

        const ids = [...new Set(history.map((h) => h.dorama_id))].slice(
          0,
          HISTORY_LIMIT
        );

        const { data: doramasData, error: doramasErr } = await supabase
          .from('doramas')
          .select('*')
          .in('id', ids);

        if (doramasErr) throw doramasErr;

        const merged = ids
          .map((id) => {
            const dorama = doramasData?.find((d) => d.id === id);
            const progress = history.find((h) => h.dorama_id === id);
            if (!dorama || !progress) return null;

            return {
              dorama_id: dorama.id,
              slug: dorama.slug,
              title: dorama.title,
              cover_url: dorama.cover_url,
              thumbnail_url: dorama.thumbnail_url,
              episode: progress.episode,
              current_time: progress.current_time,
              duration: progress.duration,
              finished: progress.finished,
            };
          })
          .filter(Boolean);

        if (!isCancelled) setItems(merged);
      } catch (e) {
        console.error('Erro ao carregar histórico:', e);
        if (!isCancelled) setError(true);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };

    loadHistory();

    return () => {
      isCancelled = true;
    };
  }, [user]);

  return (
    <>
      <Helmet>
        <title>Meu Histórico - DoramaStream</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <Navbar />

        <div
          className={`container mx-auto px-4 sm:px-6 lg:px-8 pt-24 ${
            showBottomPadding ? 'pb-28' : 'pb-12'
          }`}
        >
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold text-white flex items-center gap-3">
              <HistoryIcon className="w-8 h-8 text-purple-400" />
              Meu Histórico
            </h1>
            <p className="text-slate-400 mt-2">
              Os últimos doramas que você assistiu, com o progresso salvo.
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-slate-900 border border-slate-800 overflow-hidden animate-pulse"
                >
                  <div className="aspect-[2/3] bg-slate-800" />
                  <div className="p-3 space-y-1">
                    <div className="h-[2.5em] bg-slate-800 rounded w-4/5" />
                    <div className="h-2 bg-slate-800 rounded w-2/5" />
                    <div className="h-1.5 bg-slate-800 rounded-full w-full mt-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-12 bg-slate-900/50 rounded-xl border border-slate-800 max-w-lg mx-auto">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-1">Erro ao carregar</h3>
              <p className="text-red-400">Não foi possível carregar seu histórico.</p>
            </div>
          ) : items.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {items.map((item) => {
                const thumb = item.thumbnail_url || item.cover_url || '';
                const progress =
                  item.duration > 0
                    ? Math.min((item.current_time / item.duration) * 100, 100)
                    : 0;

                return (
                  <button
                    key={item.dorama_id}
                    onClick={() => navigate(`/dorama/${item.slug}/watch`)}
                    className="text-left bg-slate-900 border border-slate-800 rounded-lg overflow-hidden hover:border-purple-500/70 hover:bg-slate-800/80 transition-colors"
                  >
                    {thumb ? (
                      <div className="relative aspect-[2/3] overflow-hidden">
                        <img
                          src={thumb}
                          alt={item.title}
                          className="w-full h-full object-cover object-center"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    ) : (
                      <div className="relative aspect-[2/3] bg-slate-800" />
                    )}

                    <div className="p-3 space-y-1">
                      <p className="text-sm font-medium line-clamp-2 min-h-[2.5em]">
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-400">
                        Episódio {item.episode}
                      </p>

                      {progress > 0 && (
                        <div className="mt-2">
                          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-1.5 bg-purple-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {item.finished ? 'Concluído' : 'Retomar de onde parou'}
                          </p>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500 bg-slate-900/30 rounded-2xl border border-slate-800/50 border-dashed">
              <HistoryIcon className="w-10 h-10 mx-auto mb-3 text-slate-700" />
              <p className="text-lg">Você ainda não começou nenhum dorama.</p>
              <p className="text-sm mt-2 mb-6">
                Assista qualquer episódio e ele aparece aqui.
              </p>
              <Link to="/dashboard">
                <Button className="bg-purple-600 hover:bg-purple-700">
                  Explorar catálogo
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
