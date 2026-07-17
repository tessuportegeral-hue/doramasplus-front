import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Helmet } from 'react-helmet';
import { Heart, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Navbar from '@/components/Navbar';
import DoramaCard from '@/components/DoramaCard';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';

export default function Favoritos() {
  const { user } = useAuth();
  const { favoriteIds, loading: favoritesLoading } = useFavorites();

  const [doramas, setDoramas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (favoritesLoading) return;

    if (favoriteIds.size === 0) {
      setDoramas([]);
      setLoading(false);
      return;
    }

    const fetchFavorites = async () => {
      setLoading(true);
      setError(false);
      try {
        const { data, error: queryError } = await supabase
          .from('doramas')
          .select('*')
          .in('id', Array.from(favoriteIds));

        if (queryError) throw queryError;
        setDoramas(data || []);
      } catch (err) {
        console.error('Erro ao carregar favoritos:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchFavorites();
  }, [favoriteIds, favoritesLoading, user]);

  return (
    <>
      <Helmet>
        <title>Meus Favoritos - DoramaStream</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <Navbar />

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold text-white flex items-center gap-3">
              <Heart className="w-8 h-8 text-red-500 fill-red-500" />
              Meus Favoritos
            </h1>
            <p className="text-slate-400 mt-2">
              Os doramas que você salvou para assistir depois.
            </p>
          </div>

          {loading || favoritesLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[2/3] rounded-[12px] bg-slate-900 border border-slate-800 animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-12 bg-slate-900/50 rounded-xl border border-slate-800 max-w-lg mx-auto">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-1">Erro ao carregar</h3>
              <p className="text-red-400">Não foi possível carregar seus favoritos.</p>
            </div>
          ) : doramas.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {doramas.map((dorama, index) => (
                <DoramaCard key={dorama.id} dorama={dorama} index={index} />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500 bg-slate-900/30 rounded-2xl border border-slate-800/50 border-dashed">
              <Heart className="w-10 h-10 mx-auto mb-3 text-slate-700" />
              <p className="text-lg">Você ainda não tem favoritos.</p>
              <p className="text-sm mt-2 mb-6">
                Clique no coração de um dorama para salvá-lo aqui.
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
