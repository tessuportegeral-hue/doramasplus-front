// src/contexts/FavoritesContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const FavoritesContext = createContext(null);

export const FavoritesProvider = ({ children }) => {
  const { user } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setFavoriteIds(new Set());
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('favorites')
        .select('dorama_id')
        .eq('user_id', user.id);

      if (cancelled) return;

      if (!error && data) {
        setFavoriteIds(new Set(data.map((f) => f.dorama_id)));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const isFavorite = useCallback(
    (doramaId) => favoriteIds.has(doramaId),
    [favoriteIds]
  );

  const toggleFavorite = useCallback(
    async (doramaId) => {
      if (!user) return false;
      const wasFavorite = favoriteIds.has(doramaId);

      // Otimista: atualiza a UI antes da resposta do banco
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.delete(doramaId);
        else next.add(doramaId);
        return next;
      });

      if (wasFavorite) {
        const { error } = await supabase
          .from('favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('dorama_id', doramaId);

        if (error) {
          setFavoriteIds((prev) => new Set(prev).add(doramaId));
          return false;
        }
      } else {
        const { error } = await supabase
          .from('favorites')
          .insert({ user_id: user.id, dorama_id: doramaId });

        if (error) {
          setFavoriteIds((prev) => {
            const next = new Set(prev);
            next.delete(doramaId);
            return next;
          });
          return false;
        }
      }

      return true;
    },
    [user, favoriteIds]
  );

  return (
    <FavoritesContext.Provider
      value={{ favoriteIds, isFavorite, toggleFavorite, loading }}
    >
      {children}
    </FavoritesContext.Provider>
  );
};

export const useFavorites = () => {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error('useFavorites deve ser usado dentro de FavoritesProvider');
  }
  return ctx;
};
