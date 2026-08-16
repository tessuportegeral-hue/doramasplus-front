import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { optimizeCover } from '@/lib/optimizeCover';
import { Helmet } from 'react-helmet';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Heart, Headphones, Captions, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { toast } from '@/components/ui/use-toast';

// ✅ 16/08 — categorias como CHIPS CLICÁVEIS (link interno pra página da
// categoria, que já existe em App.jsx). Antes era texto morto "A, B, C".
// Bom pro cliente (descobre mais) e pro Google (links internos pras
// categorias). is_featured/is_recommended seguem fora (são internas).
const CATEGORY_LINKS = [
  { flag: 'is_new', label: 'Novo Lançamento', to: '/novos' },
  { flag: 'is_baby_pregnancy', label: 'Bebês e Gravidezes', to: '/gravidez-e-bebe' },
  { flag: 'is_taboo_relationship', label: 'Relacionamento Tabu', to: '/relacionamento-tabu' },
  { flag: 'is_hidden_identity', label: 'Identidade Escondida', to: '/identidade-escondida' },
  { flag: 'is_lobos_vampiros', label: 'Lobos & Vampiros', to: '/lobos-e-vampiros' },
  { flag: 'is_bl_gl', label: 'BL & GL', to: '/bl-gl' },
  { flag: 'is_brasileiro', label: 'Brasileiros', to: '/brasileiros' },
  { flag: 'is_anime', label: 'Animes', to: '/animes' },
];

function buildCategoryChips(dorama) {
  if (!dorama) return [];
  const chips = [];
  const seen = new Set();
  const push = (label, to) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    chips.push({ label, to });
  };
  // Campo genres do banco (texto livre) — sem link (não tem página própria)
  if (dorama.genres && dorama.genres.trim()) {
    dorama.genres.split(',').forEach((g) => {
      const t = g.trim();
      if (t) push(t, null);
    });
  }
  for (const c of CATEGORY_LINKS) if (dorama[c.flag]) push(c.label, c.to);
  return chips;
}

// ✅ 16/08 — áudio: "Dublado", "Legendado" ou "Dublado + Legendado" (quando
// tem versão alternativa cadastrada). Vira badge no topo + entra no <title>.
function audioInfo(dorama) {
  const dub = dorama?.language === 'dublado';
  const hasAlt = !!(dorama?.alt_bunny_url || dorama?.alt_bunny_stream_url);
  if (hasAlt) return { label: 'Dublado + Legendado', dub: true, leg: true };
  if (dub) return { label: 'Dublado', dub: true, leg: false };
  return { label: 'Legendado', dub: false, leg: true };
}

// ✅ 16/08 — SEO: título com "assistir" + idioma + marca (era "X - Detalhes"),
// description com chamada pra ação na frente da sinopse.
// Mesmo formato do middleware.js (que serve o HTML pros bots) — cliente e
// Google veem o MESMO título.
function seoTitle(dorama, audio) {
  const year = dorama.release_year ? ` (${dorama.release_year})` : '';
  return `${dorama.title}${year} — Assistir ${audio.label} Online | DoramasPlus`;
}
function seoDescription(dorama, audio) {
  const base = `Assista ${dorama.title} ${audio.label.toLowerCase()} online no DoramasPlus.`;
  const desc = (dorama.description || '').replace(/\s+/g, ' ').trim();
  if (!desc) return `${base} Doramas dublados e legendados, sem anúncios.`;
  const room = 158 - base.length - 1;
  const cut = desc.length > room ? desc.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '') + '…' : desc;
  return `${base} ${cut}`;
}

export default function DoramaDetail() {
  const { id: slugFromUrl } = useParams();
  const navigate = useNavigate();

  const [dorama, setDorama] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // ✅ 13/08 — separa "confirmadamente não existe" (query OK, zero linhas,
  // sem redirect) de "falha momentânea de rede/banco". O noindex só pode ir
  // pro 1º caso: eram 429 páginas REAIS excluídas por noindex no Search
  // Console porque o renderizador do Google visitava na hora de uma falha
  // transitória e a tela de erro carimbava noindex na página inteira.
  const [notFound, setNotFound] = useState(false);
  // ✅ 16/08 — "Quem viu esse também viu": carrega DEPOIS do load+idle pra
  // não competir com o LCP (pôster); slot com altura mínima reservada no
  // JSX pra não gerar CLS quando chega.
  const [related, setRelated] = useState([]);

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
        //
        // Retry: uma instabilidade momentânea no banco (timeout, pico de
        // carga) não pode virar "dorama não encontrado" + noindex pro
        // Google — isso tira conteúdo real do índice (achado 27/07: doramas
        // recém-criados marcados como noindex mesmo existindo no banco).
        let data = null;
        let queryError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await supabase
            .from('doramas')
            .select('*')
            .eq('slug', normalizedSlug)
            .maybeSingle();
          data = res.data;
          queryError = res.error;
          if (!queryError && data) break;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }

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
          setNotFound(true);
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

  useEffect(() => {
    if (!dorama?.id) return;
    let cancelled = false;
    const load = async () => {
      try {
        // prioriza a 1ª categoria do dorama; sem categoria, pega novos
        const cat = CATEGORY_LINKS.find((c) => c.flag !== 'is_new' && dorama[c.flag]);
        let q = supabase
          .from('doramas')
          .select('id,slug,title,cover_url,language')
          .neq('id', dorama.id)
          .order('created_at', { ascending: false })
          .limit(6);
        if (cat) q = q.eq(cat.flag, true);
        const { data } = await q;
        if (!cancelled && Array.isArray(data)) setRelated(data);
      } catch {
        /* recomendados são opcionais */
      }
    };
    const kick = () => {
      if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 4000 });
      else setTimeout(load, 1500);
    };
    if (document.readyState === 'complete') kick();
    else window.addEventListener('load', kick, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', kick);
    };
  }, [dorama?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 pb-12 animate-pulse">
        <div className="container mx-auto px-4 py-6">
          <div className="h-9 w-40 bg-slate-900 rounded mb-4" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <div className="md:col-span-1 space-y-6">
              <div className="aspect-[2/3] rounded-2xl border border-slate-800 max-w-sm mx-auto bg-slate-900" />
              <div className="h-12 w-full bg-slate-900 rounded-md" />
              <div className="h-12 w-full bg-slate-900 rounded-md" />
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
        {/* noindex SÓ quando o dorama confirmadamente não existe — falha
            momentânea de rede/banco mostra o erro pro usuário mas NÃO manda
            o Google desindexar uma página real. */}
        {notFound && (
          <Helmet>
            <meta name="robots" content="noindex" />
          </Helmet>
        )}
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

  const chips = buildCategoryChips(dorama);
  const audio = audioInfo(dorama);
  const watchTarget = `/dorama/${slugFromUrl}/watch`;

  return (
    <>
      <Helmet>
        <title>{seoTitle(dorama, audio)}</title>
        <meta name="description" content={seoDescription(dorama, audio)} />
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
                    src={optimizeCover(dorama.cover_url, 600)}
                    alt={`Capa de ${dorama.title}`}
                    width={400}
                    height={600}
                    fetchpriority="high"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Button
                  onClick={() => navigate(watchTarget)}
                  size="lg"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-lg font-bold py-6"
                >
                  <Play className="w-6 h-6 mr-3" />
                  Assistir agora
                </Button>
                {/* ✅ 16/08 — contexto pro visitante que cai do Google: sabe o
                    que esperar antes de encarar a tela de login. */}
                {!isAuthenticated && (
                  <p className="text-center text-xs text-slate-400 leading-snug">
                    Assinantes assistem sem anúncios · a partir de{' '}
                    <span className="text-slate-200 font-semibold">R$17,90/mês</span>
                    {' · '}
                    <Link to="/plans" className="text-purple-400 hover:text-purple-300 underline underline-offset-2">
                      ver planos
                    </Link>
                  </p>
                )}
              </div>

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
              <div className="space-y-3">
                <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
                  {dorama.title}
                </h1>

                {/* ✅ 16/08 — badges de áudio + ano, visíveis de cara */}
                <div className="flex items-center gap-2 flex-wrap">
                  {audio.dub && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 border border-blue-500/30 px-3 py-1 text-xs font-semibold text-blue-300">
                      <Headphones className="w-3.5 h-3.5" /> Dublado
                    </span>
                  )}
                  {audio.leg && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300">
                      <Captions className="w-3.5 h-3.5" /> Legendado
                    </span>
                  )}
                  {dorama.release_year && (
                    <span className="inline-flex items-center rounded-full bg-slate-800 border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300">
                      {dorama.release_year}
                    </span>
                  )}
                </div>

                {/* ✅ 16/08 — categorias clicáveis */}
                {chips.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {chips.map((c) =>
                      c.to ? (
                        <Link
                          key={c.label}
                          to={c.to}
                          className="rounded-md bg-slate-900 border border-slate-800 hover:border-purple-500/50 hover:text-white px-2.5 py-1 text-xs text-slate-300 transition-colors"
                        >
                          {c.label}
                        </Link>
                      ) : (
                        <span
                          key={c.label}
                          className="rounded-md bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs text-slate-400"
                        >
                          {c.label}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="prose prose-invert max-w-none">
                <h3 className="text-xl font-semibold text-white mb-3">Sinopse</h3>
                <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                  {dorama.description || 'Nenhuma descrição disponível.'}
                </p>
              </div>

              {/* ✅ 16/08 — bloco "Detalhes" sem redundância: só o que não
                  está no topo. */}
              <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-800/50">
                <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">Detalhes</h4>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Áudio</dt>
                    <dd className="text-slate-200 font-medium">{audio.label}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Lançamento</dt>
                    <dd className="text-slate-200">{dorama.release_year || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Onde assistir</dt>
                    <dd className="text-slate-200">Site e app oficial (Android)</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Anúncios</dt>
                    <dd className="text-slate-200">Nenhum</dd>
                  </div>
                </dl>
              </div>

              {/* ✅ 16/08 — Quem viu esse também viu (carrega pós-load; slot
                  com min-height pra não empurrar nada quando chegar) */}
              <section className="min-h-[220px]">
                {related.length > 0 && (
                  <>
                    <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-400" /> Quem viu esse também viu
                    </h3>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                      {related.map((r) => (
                        <Link key={r.id} to={`/dorama/${r.slug}`} className="group block">
                          <div className="aspect-[2/3] rounded-lg overflow-hidden bg-slate-900 border border-slate-800 group-hover:border-purple-500/50 transition-colors">
                            {r.cover_url && (
                              <img
                                src={optimizeCover(r.cover_url, 300)}
                                alt={r.title}
                                loading="lazy"
                                decoding="async"
                                width={200}
                                height={300}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <p className="mt-1.5 text-xs text-slate-300 line-clamp-2 group-hover:text-white">
                            {r.title}
                          </p>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
