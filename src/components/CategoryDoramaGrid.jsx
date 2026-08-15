// src/components/CategoryDoramaGrid.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { AlertCircle, Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import DoramaCard from '@/components/DoramaCard';
import { supabase } from '@/lib/supabaseClient';

const PAGE_SIZE = 60;

// Página genérica de categoria com paginação real (.range no banco) em vez de
// puxar tudo de uma vez — com categorias de milhares de doramas (ex: "novo",
// "dublado"), carregar tudo de uma vez trava celular mais fraco: cada card
// monta uma animação (Framer Motion) própria, então 1000+ cards ao mesmo
// tempo pesa demais o processador. Aqui carrega 60 por vez, com botão
// "Carregar mais" pra pedir a próxima leva.
//
// Busca: essa página não tem campo de busca próprio — a busca já existe,
// global, na Navbar/Dashboard. Um campo de busca aqui ficaria restrito à
// categoria, o que confunde (usuário busca e não entende por que não achou
// algo que existe em outra categoria).
export default function CategoryDoramaGrid({
  pageTitle,
  title,
  subtitle,
  icon,
  spinnerClass,
  emptyMessage,
  applyFilter, // (query) => query já com .eq/.or aplicado — precisa ser estável (definida fora do componente que chama)
}) {
  const [doramas, setDoramas] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const buildQuery = useCallback(
    (from, to) => {
      let q = supabase.from('doramas').select('*').order('created_at', { ascending: false });
      q = applyFilter(q);
      return q.range(from, to);
    },
    [applyFilter]
  );

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: err } = await buildQuery(0, PAGE_SIZE - 1);
    if (err) {
      console.error(`[CategoryDoramaGrid:${pageTitle}] first_page`, err);
      setError(true);
      setDoramas([]);
      setHasMore(false);
    } else {
      setDoramas(data || []);
      setHasMore((data || []).length === PAGE_SIZE);
    }
    setPage(0);
    setLoading(false);
  }, [buildQuery, pageTitle]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const from = nextPage * PAGE_SIZE;
    const { data, error: err } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (err) {
      console.error(`[CategoryDoramaGrid:${pageTitle}] load_more`, err);
    } else {
      setDoramas((prev) => [...prev, ...(data || [])]);
      setHasMore((data || []).length === PAGE_SIZE);
      setPage(nextPage);
    }
    setLoadingMore(false);
  }, [buildQuery, page, hasMore, loadingMore, pageTitle]);

  return (
    <>
      <Helmet>
        <title>{pageTitle} - DoramasPlus</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <Navbar />

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold text-white flex items-center gap-3">
              {icon}
              {title}
            </h1>
            <p className="text-slate-400 mt-2">{subtitle}</p>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${spinnerClass}`}></div>
            </div>
          ) : error ? (
            <div className="text-center py-12 bg-slate-900/50 rounded-xl border border-slate-800 max-w-lg mx-auto">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-1">Erro ao carregar</h3>
              <p className="text-red-400">Não foi possível carregar os doramas.</p>
              <button
                onClick={loadFirstPage}
                className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-md text-sm transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          ) : doramas.length > 0 ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                {doramas.map((dorama, index) => (
                  <DoramaCard key={dorama.id} dorama={dorama} index={index % 10} />
                ))}
              </div>

              <div className="flex flex-col items-center gap-2 mt-10">
                {hasMore ? (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 rounded-full text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                    {loadingMore ? 'Carregando...' : 'Carregar mais'}
                  </button>
                ) : (
                  <p className="text-slate-500 text-xs">Isso é tudo que a gente tem por aqui.</p>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-20 text-slate-500 bg-slate-900/30 rounded-2xl border border-slate-800/50 border-dashed">
              <p className="text-lg">{emptyMessage}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
