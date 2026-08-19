import React, { useMemo, startTransition } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Calendar, Eye, ImageOff, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { toast } from '@/components/ui/use-toast';
import { optimizeCover } from '@/lib/optimizeCover';

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
  const navigate = useNavigate();

  // ✅ 07/08 — card compacto (sem botão "Assistir Agora", cartão inteiro
  // clicável), pra bater com o card mais estreito do Dashboard. Testado
  // com tesagencia antes; liberado geral (logado ou não) em 07/08 — o
  // sitemap.xml já lista /privacidade direto, então tirar link redundante
  // de rodapé não afeta indexação.
  const { isAuthenticated } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(dorama.id);
  const compact = true;

  const handleToggleFavorite = async (e) => {
    e.preventDefault();
    e.stopPropagation();

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

  // ✅ 07/08 — só onClick (sem role/tabIndex/onKeyDown): agora que o título
  // tem um <Link> de verdade dentro, ele já cobre teclado nativamente.
  // Duplicar role="link"+tabIndex no card inteiro criava duas "paradas" de
  // Tab pro mesmo destino — clique no resto do card continua funcionando
  // por mouse/toque via este onClick.
  return (
    // ✅ 17/08 (INP round 31) — motion.div → div + animação CSS. O Framer
    // rodava JS a CADA FRAME de CADA card (opacity+translateY com stagger de
    // index*100ms = até 2,3s de timers por grid), e isso acontece toda vez
    // que cards entram: cada tecla na busca (grid muda) e cada onda de
    // fileiras da home. Era o `h` FrameRequestCallback + boa parte do `V` e
    // do presentationDelay do LoAF em celular fraco. A animação de entrada
    // continua igual visualmente, mas em @keyframes: zero JS por frame, o
    // compositor anima sozinho e não segura toque. Stagger limitado a 8
    // cards (800ms) — depois disso ninguém percebe e economiza timeline.
    <div
      // ✅ 19/08 (INP round 40, pesquisa web.dev/corewebvitals.io): as SEÇÕES
      // da home já pulam render fora da tela (13/08), mas DENTRO de cada
      // fileira horizontal todos os 10-30 cards renderizavam mesmo com só
      // ~2,5 visíveis no celular — ~90% do DOM de card era custo invisível
      // que TODA interação paga em style/layout (presentation ~42% do INP,
      // e o recálculo escala com o tamanho do DOM). content-visibility:auto
      // no card deixa o navegador pular render dos que estão fora da janela
      // do scroller horizontal também. contain-intrinsic-size reserva o
      // espaço (largura vem do pai; altura ~ capa 2:3 + texto) = zero CLS.
      style={{
        animationDelay: `${Math.min(index || 0, 8) * 0.1}s`,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 300px",
      }}
      // ✅ 16/08 (INP) — navigate dentro de startTransition: o toque no card
      // era um onclick síncrono (LoAF `yS` 130-325ms + presentation 400-600ms
      // no mobile) — o React montava a rota nova antes de pintar o feedback do
      // toque. Como transição, o frame do toque sai primeiro e a página nova
      // vem interrompível (mesma prioridade que o <Link> já tem com
      // v7_startTransition).
      onClick={compact ? () => startTransition(() => navigate(linkTarget)) : undefined}
      className={
        compact
          ? `dp-card-in group relative rounded-[12px] overflow-hidden
             transition-all duration-250 ease-in-out
             hover:scale-[1.03]
             flex flex-col cursor-pointer`
          : `dp-card-in group relative bg-slate-900 rounded-[12px] overflow-hidden
             border border-slate-800
             shadow-lg shadow-black/30
             hover:border-purple-500/50
             hover:shadow-2xl hover:shadow-purple-500/20
             transition-all duration-250 ease-in-out
             hover:scale-[1.03]
             flex flex-col`
      }
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-slate-950 rounded-t-[12px]">
        {coverUrl ? (
          <img
            src={optimizeCover(coverUrl, 300)}
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

        {(dorama.language === 'dublado' || dorama.alt_bunny_url) && !hideDubladoBadge && (
          <span className="absolute top-2 left-2 z-10 px-2 py-0.5 text-[10px] font-bold tracking-wide bg-purple-600 text-white rounded shadow-md">
            DUBLADO
          </span>
        )}

        <button
          type="button"
          onClick={handleToggleFavorite}
          aria-label={favorited ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-slate-950/60 backdrop-blur-sm border border-slate-700/50 hover:bg-slate-950/90 transition-colors"
        >
          <Heart
            className={`w-4 h-4 transition-colors ${
              favorited ? 'text-red-500 fill-red-500' : 'text-white'
            }`}
          />
        </button>

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <Link to={linkTarget}>
            <div className="bg-purple-600 p-4 rounded-full shadow-lg transform scale-0 group-hover:scale-100 transition-transform duration-300 hover:bg-purple-500">
              <Play className="w-8 h-8 text-white fill-white pl-1" />
            </div>
          </Link>
        </div>
      </div>

      <div className={compact ? 'p-2 flex flex-col' : 'p-2.5 flex flex-col'}>
        {!hideYear && (
          <div className="flex items-center gap-1 mb-1 text-[11px] text-slate-400">
            <Calendar className="w-3 h-3" />
            <span>{displayYear}</span>
          </div>
        )}

        {compact ? (
          <h3 className="text-xs font-semibold text-white line-clamp-2 leading-tight min-h-[2.4em] mb-1 group-hover:text-purple-400 transition-colors">
            {/* ✅ 07/08 — link real (não só onClick no card inteiro) pro
                Google continuar encontrando/indexando a página do dorama
                com o título como texto âncora */}
            <Link to={linkTarget} onClick={(e) => e.stopPropagation()}>
              {dorama.title}
            </Link>
          </h3>
        ) : (
          <h3 className="text-sm sm:text-base font-semibold text-white line-clamp-2 leading-tight min-h-[2.5em] mb-1 group-hover:text-purple-400 transition-colors">
            <Link to={linkTarget}>
              {dorama.title}
            </Link>
          </h3>
        )}

        <div className={`flex items-center gap-1 text-xs text-slate-400 ${compact ? '' : 'mb-2'}`}>
          <Eye className="w-3 h-3" />
          <span>{formattedViews}</span>
        </div>

        {!compact && (
          <Link to={linkTarget} className="w-full block">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 group-hover:border-purple-500/50 group-hover:text-purple-300"
            >
              Assistir Agora
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
};

// ✅ 17/08 (INP round 33) — React.memo: props são primitivos + o objeto
// `dorama` (identidade estável dentro do array de estado). Sem memo, todo
// re-render do Dashboard (tecla da busca, flag de loading, banner) refazia
// os 24 cards do grid de resultados. Contextos (auth/favoritos) seguem
// re-renderizando o card quando mudam — só o pai deixa de arrastar.
export default React.memo(DoramaCard);
