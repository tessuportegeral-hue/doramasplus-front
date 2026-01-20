import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Play, Calendar, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DoramaCard = ({ dorama, index }) => {
  const getGenres = () => {
    if (!dorama.genres) return [];
    if (Array.isArray(dorama.genres)) return dorama.genres;
    if (typeof dorama.genres === 'string') {
      return dorama.genres.split(',').map(g => g.trim()).filter(Boolean);
    }
    return [];
  };

  const displayGenres = getGenres();

  const linkTarget = dorama.slug ? `/dorama/${dorama.slug}` : `/dorama/${dorama.id}`;

  const coverUrl = useMemo(() => {
    return (
      dorama.cover_url ||
      dorama.thumbnail_url ||
      dorama.banner_url ||
      ''
    );
  }, [dorama]);

  // ✅ Ano com fallback seguro (resolve o "TBA" voltando a mostrar ano)
  const displayYear = useMemo(() => {
    const yr = dorama?.release_year;

    if (typeof yr === 'number' && Number.isFinite(yr)) return String(yr);

    if (typeof yr === 'string') {
      const onlyDigits = yr.trim();
      // pega "2024" ou "2024-..." etc
      const m = onlyDigits.match(/\b(19|20)\d{2}\b/);
      if (m?.[0]) return m[0];
    }

    const created = dorama?.created_at;
    if (created) {
      const d = new Date(created);
      if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
    }

    return 'TBA';
  }, [dorama]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index ? index * 0.1 : 0 }}
      className="group relative bg-slate-900 rounded-[12px] overflow-hidden 
                 border border-slate-800 
                 shadow-lg shadow-black/30 
                 hover:border-purple-500/50 
                 hover:shadow-2xl hover:shadow-purple-500/20 
                 transition-all duration-250 ease-in-out 
                 hover:scale-[1.03] 
                 flex flex-col h-full"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-slate-950 rounded-t-[12px]">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={dorama.title}
            className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-110"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-700 bg-slate-900">
            <ImageOff className="w-12 h-12" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <Link to={linkTarget}>
            <div className="bg-purple-600 p-4 rounded-full shadow-lg transform scale-0 group-hover:scale-100 transition-transform duration-300 hover:bg-purple-500">
              <Play className="w-8 h-8 text-white fill-white pl-1" />
            </div>
          </Link>
        </div>
      </div>

      <div className="p-4 flex flex-col flex-grow">
        <div className="flex items-center justify-between mb-2 text-xs text-slate-400">
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <span>{displayYear}</span>
          </div>
        </div>

        <h3 className="text-lg font-bold text-white mb-2 line-clamp-1 group-hover:text-purple-400 transition-colors">
          <Link to={linkTarget}>
            {dorama.title}
          </Link>
        </h3>

        <div className="flex flex-wrap gap-2 mb-4 h-6 overflow-hidden">
          {displayGenres.slice(0, 2).map((g, i) => (
            <span
              key={i}
              className="text-xs text-slate-300 bg-slate-800 px-2 py-1 rounded-md whitespace-nowrap"
            >
              {g}
            </span>
          ))}
        </div>

        <div className="mt-auto">
          <Link to={linkTarget} className="w-full block">
            <Button
              variant="outline"
              className="w-full border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 group-hover:border-purple-500/50 group-hover:text-purple-300"
            >
              Assistir Agora
            </Button>
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

export default DoramaCard;