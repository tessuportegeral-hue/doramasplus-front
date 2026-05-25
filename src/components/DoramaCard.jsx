import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Play, Calendar, Eye, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Views fictícios determinísticos a partir do id (djb2), entre 1300 e 3500
const generateViews = (id) => {
  const s = String(id || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  const min = 1300;
  const max = 3500;
  return min + (Math.abs(h) % (max - min + 1));
};

const DoramaCard = ({ dorama, index, hideYear = false, hideDubladoBadge = false }) => {
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

  const views = useMemo(() => generateViews(dorama.id), [dorama.id]);
  const formattedViews = useMemo(() => views.toLocaleString('pt-BR'), [views]);

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
                 flex flex-col"
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-slate-950 rounded-t-[12px]">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={dorama.title}
            className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-110"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-700 bg-slate-900">
            <ImageOff className="w-12 h-12" />
          </div>
        )}

        {dorama.language === 'dublado' && !hideDubladoBadge && (
          <span className="absolute top-2 left-2 z-10 px-2 py-0.5 text-[10px] font-bold tracking-wide bg-purple-600 text-white rounded shadow-md">
            DUBLADO
          </span>
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

      <div className="p-2.5 flex flex-col">
        {!hideYear && (
          <div className="flex items-center gap-1 mb-1 text-[11px] text-slate-400">
            <Calendar className="w-3 h-3" />
            <span>{displayYear}</span>
          </div>
        )}

        <h3 className="text-sm sm:text-base font-semibold text-white line-clamp-2 leading-tight min-h-[2.5em] mb-1 group-hover:text-purple-400 transition-colors">
          <Link to={linkTarget}>
            {dorama.title}
          </Link>
        </h3>

        <div className="flex items-center gap-1 mb-2 text-xs text-slate-400">
          <Eye className="w-3 h-3" />
          <span>{formattedViews}</span>
        </div>

        <Link to={linkTarget} className="w-full block">
          <Button
            variant="outline"
            size="sm"
            className="w-full border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 group-hover:border-purple-500/50 group-hover:text-purple-300"
          >
            Assistir Agora
          </Button>
        </Link>
      </div>
    </motion.div>
  );
};

export default DoramaCard;
