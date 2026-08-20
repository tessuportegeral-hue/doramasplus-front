// src/pages/Dashboard.jsx
import React, { useEffect, useState, useCallback, useRef, useMemo, startTransition } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { noteSearchState, noteSectionState } from "@/lib/reportWebVitals";
import { optimizeCover } from "@/lib/optimizeCover";
import useDebouncedField from "@/hooks/useDebouncedField";
import { playStoreUrl } from "@/lib/playStoreLink";
import { useAuth } from "@/contexts/SupabaseAuthContext";

import Navbar from "@/components/Navbar";
import DoramaCard from "@/components/DoramaCard";
import SelectedTesterModal from "@/components/SelectedTesterModal";

import { Button } from "@/components/ui/button";
import {
  Play,
  Info,
  ArrowLeft,
  ArrowRight,
  Loader2,
  ServerCrash,
  Sparkles,
  Star,
  Globe,
  Baby,
  HeartHandshake,
  Eye,
  Heart,
  Moon,
  Tv,
  Flag,
  ExternalLink,
  Gift,
  Bot,
  Smartphone,
  Plus,
  Send,
} from "lucide-react";

const LIST_LIMIT = 60; // 11 categorias × ~60 = ~660 cards potenciais (antes: 250 = ~2750)
const RECOMMENDED_LIMIT = 100; // antes: 400

// ✅ definição única do filtro de cada categoria (fileira da home), reusada
// tanto na carga inicial quanto no "Carregar mais" — antes cada fileira só
// carregava esse limite fixo e nunca mais, sem jeito de ver o resto sem
// entrar na página dedicada da categoria.
const CATEGORY_QUERIES = {
  new: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_new", true).order("created_at", { ascending: false }),
  },
  dubbed: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase
        .from("doramas")
        .select(selectStr)
        .or("language.eq.dublado,alt_bunny_url.not.is.null")
        .order("created_at", { ascending: false }),
  },
  baby: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_baby_pregnancy", true).order("created_at", { ascending: false }),
  },
  taboo: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_taboo_relationship", true).order("created_at", { ascending: false }),
  },
  lobos_vampiros: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_lobos_vampiros", true).order("created_at", { ascending: false }),
  },
  bl_gl: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_bl_gl", true).order("created_at", { ascending: false }),
  },
  brasileiro: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_brasileiro", true).order("created_at", { ascending: false }),
  },
  anime: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_anime", true).order("created_at", { ascending: false }),
  },
  hidden: {
    limit: LIST_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_hidden_identity", true).order("created_at", { ascending: false }),
  },
  recommended: {
    limit: RECOMMENDED_LIMIT,
    build: (selectStr) =>
      supabase.from("doramas").select(selectStr).eq("is_recommended", true).order("created_at", { ascending: false }),
  },
};

// ✅ Seletores em fallback (pra NUNCA quebrar por coluna inexistente)
const SELECT_LEVELS = [
  // Mais completo (se existir tudo)
  "id,slug,title,description,created_at,banner_url,cover_url,language,alt_bunny_url,is_featured,is_new,is_recommended,is_baby_pregnancy,is_taboo_relationship,is_hidden_identity,is_bl_gl,is_lobos_vampiros,is_anime,is_brasileiro",
  // Médio (remove campos que costumam não existir em alguns schemas)
  "id,slug,title,description,created_at,banner_url,cover_url,language,alt_bunny_url,is_featured,is_new,is_recommended,is_baby_pregnancy,is_taboo_relationship,is_hidden_identity,is_bl_gl,is_lobos_vampiros,is_anime,is_brasileiro",
  // Mínimo (quase impossível falhar)
  "id,slug,title,description,created_at,cover_url,language,is_featured,is_new",
];

const isMissingColumnError = (err) => {
  const msg = (err?.message || "").toLowerCase();
  // PostgREST normalmente: "column <x> does not exist"
  return msg.includes("does not exist") && msg.includes("column");
};

const runQueryWithFallback = async (buildQueryFn) => {
  let lastError = null;

  for (const selectStr of SELECT_LEVELS) {
    try {
      const query = buildQueryFn(selectStr);
      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null, selectUsed: selectStr };
    } catch (e) {
      lastError = e;
      // Se não for erro de coluna faltando, não adianta tentar outros selects
      if (!isMissingColumnError(e)) break;
    }
  }

  return { data: [], error: lastError };
};

// ---------------- HERO SECTION (BANNER) ----------------
const HeroSection = ({ featuredDoramas, loading, paused = false }) => {
  const { isAuthenticated } = useAuth(); // mantido (não removi nada)
  const navigate = useNavigate();
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) =>
      prev === featuredDoramas.length - 1 ? 0 : prev + 1
    );
  }, [featuredDoramas.length]);

  const handlePrev = () => {
    setCurrentIndex((prev) =>
      prev === 0 ? featuredDoramas.length - 1 : prev - 1
    );
  };

  useEffect(() => {
    // ✅ 20/08 (INP round 44) — `paused` durante a busca: com o hero MONTADO
    // e escondido (round 43), o auto-rotate de 7s continuava re-renderizando
    // o carrossel invisível enquanto a pessoa digita — inputDelay do teclado
    // no p75 dobrou (67→130ms). Escondido não roda timer.
    if (!paused && featuredDoramas.length > 1) {
      const timer = setInterval(handleNext, 7000);
      return () => clearInterval(timer);
    }
  }, [featuredDoramas.length, handleNext, paused]);

  // ✅ 13/08 (sonda v6) — diário de branch do hero (mesma ideia das seções):
  // registra loading/null/ready e o desmonte (modo busca) com timestamp.
  // ✅ 13/08 (LCP) — com o cache de destaques, "tem dado" ganha do "está
  // carregando": o hero da revisita pinta no 1º frame e NÃO volta pro
  // placeholder durante o refetch (remontar a img resetaria o LCP).
  const hasFeatured = featuredDoramas && featuredDoramas.length > 0;
  const heroBranch = hasFeatured ? "ready" : loading ? "loading" : "null";
  useEffect(() => {
    noteSectionState("hero", heroBranch);
  }, [heroBranch]);
  useEffect(() => () => noteSectionState("hero", "gone"), []);

  // ✅ 13/08 (LCP) — guarda a URL do 1º banner pro preload do main.jsx e os
  // próprios destaques pro render instantâneo do Dashboard (na PRÓXIMA
  // visita o hero pinta no 1º frame, sem esperar o fetch).
  useEffect(() => {
    try {
      const first = featuredDoramas && featuredDoramas[0];
      if (!first) return;
      const url =
        first.banner_url || first.cover_url || first.thumbnail_url || "";
      // ✅ 14/08 (LCP) — salva já a URL OTIMIZADA (mesma do src do hero
      // mobile) pra o preload do main.jsx acertar o cache byte a byte.
      if (url) localStorage.setItem("dp_last_hero_url", optimizeCover(url, 828));
      localStorage.setItem(
        "dp_featured_cache",
        JSON.stringify(featuredDoramas.slice(0, 6))
      );
    } catch {
      /* ignore */
    }
  }, [featuredDoramas]);

  // ✅ ALTERAÇÃO ÚNICA: banner agora manda direto pro /watch (teste grátis funciona)
  const handleWatchClick = (slug) => {
    navigate(`/dorama/${slug}/watch`);
  };

  if (!hasFeatured && loading) {
    // ✅ 11/08 — a altura TEM que bater com o hero real (h-[65vh] md:h-[70vh],
    // logo abaixo). Antes o placeholder era h-[50vh] no celular e o conteúdo
    // real 65vh: todo carregamento mobile empurrava a página 15vh pra baixo
    // (CLS). Mesmo tipo de descompasso do fix de 26/07, só que na home. Ver
    // [[project-cls-regression-favorites-fix]].
    return (
      <div className="relative w-full h-[65svh] md:h-[70svh] bg-slate-900 flex items-center justify-center rounded-lg overflow-hidden">
        <Loader2 className="w-10 h-10 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!hasFeatured) return null;

  const current = featuredDoramas[currentIndex];
  if (!current) return null;

  // ✅ fallback seguro pra não "sumir imagem"
  const bannerUrl =
    current.banner_url || current.cover_url || current.thumbnail_url || "";
  const posterUrl =
    current.thumbnail_url || current.cover_url || current.banner_url || "";
  const linkTarget = `/dorama/${current.slug}`;

  // ✅ 11/08 — svh (small viewport height) em vez de vh: vh muda quando a
  // barra de URL do celular some/aparece, então o hero (65vh) redimensionava
  // no load e empurrava TODAS as seções abaixo (a telemetria pegou o hero
  // indo de 438→514px). svh é fixo na tela pequena, não mexe. Ver
  // [[project-web-vitals-rum-instrumentation]].
  return (
    <section className="relative w-full h-[65svh] md:h-[70svh] rounded-lg overflow-hidden home-hero mb-6 md:mb-8">
      {/* MOBILE */}
      <div className="md:hidden relative w-full h-full">
        {bannerUrl ? (
          <img
            src={optimizeCover(bannerUrl, 828)}
            alt={current.title}
            className="absolute inset-0 w-full h-full object-cover"
            decoding="async"
            fetchpriority="high"
          />
        ) : (
          <div className="absolute inset-0 bg-slate-900" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent" />

        <div className="relative z-10 flex flex-col justify-end h-full px-4 pb-6 pt-16 space-y-3">
          <h2 className="text-2xl font-bold text-white line-clamp-2">
            {current.title}
          </h2>

          <p className="text-sm text-slate-200 line-clamp-3">
            {current.description}
          </p>

          <div className="flex gap-3 mt-3">
            <Button
              onClick={() => handleWatchClick(current.slug)}
              className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg"
            >
              <Play className="w-5 h-5 mr-2 fill-white" /> Assistir agora
            </Button>

            <Button
              onClick={() => navigate(linkTarget)}
              variant="outline"
              className="flex-1 border-slate-700 text-slate-100 hover:bg-slate-900/60 py-3 rounded-lg"
            >
              <Info className="w-5 h-5 mr-2" /> Detalhes
            </Button>
          </div>
        </div>

        {/* SETAS NO MOBILE */}
        {featuredDoramas.length > 1 && (
          <div className="absolute inset-y-0 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
            <button
              type="button"
              onClick={handlePrev}
              className="pointer-events-auto flex items-center justify-center w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur transition text-white"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="pointer-events-auto flex items-center justify-center w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur transition text-white"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* DESKTOP */}
      <div className="hidden md:block relative w-full h-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0"
          >
            {bannerUrl ? (
              <img
                src={optimizeCover(bannerUrl, 1600)}
                alt={current.title}
                className="w-full h-full object-cover"
                decoding="async"
                fetchpriority="high"
              />
            ) : (
              <div className="w-full h-full bg-slate-900" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/70 to-transparent" />
          </motion.div>
        </AnimatePresence>

        <div className="absolute inset-0 flex items-center justify-between px-10 lg:px-16">
          {/* TEXTO À ESQUERDA */}
          <div className="w-full lg:w-1/2 text-white max-w-xl">
            <h1 className="text-3xl lg:text-4xl font-bold mb-4">
              {current.title}
            </h1>

            <p className="text-slate-200 mb-6 text-sm lg:text-base line-clamp-4">
              {current.description || "Sem sinopse disponível."}
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <Button
                onClick={() => handleWatchClick(current.slug)}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-lg"
              >
                <Play className="w-5 h-5 mr-2 fill-white" /> Assistir agora
              </Button>

              <Button
                onClick={() => navigate(linkTarget)}
                variant="outline"
                className="border-slate-700 text-slate-100 hover:bg-slate-800 text-base px-6 py-3 rounded-lg"
              >
                <Info className="w-5 h-5 mr-2" /> Mais detalhes
              </Button>
            </div>
          </div>

          {/* CARD DE CAPA À DIREITA */}
          {posterUrl && (
            <div className="hidden md:flex flex-shrink-0 w-[260px] lg:w-[290px] h-[380px] lg:h-[430px] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl shadow-black/60 bg-slate-900/70 mr-4 lg:mr-8">
              <img
                src={posterUrl}
                alt={current.title}
                className="w-full h-full object-cover"
                decoding="async"
                fetchpriority="high"
              />
            </div>
          )}
        </div>

        {featuredDoramas.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/30 hover:bg-black/60 rounded-full"
            >
              <ArrowLeft className="w-6 h-6 text-white" />
            </button>

            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/30 hover:bg-black/60 rounded-full"
            >
              <ArrowRight className="w-6 h-6 text-white" />
            </button>
          </>
        )}
      </div>
    </section>
  );
};

// ✅ 13/08 (INP) — caixa de busca do visitante como componente próprio com
// estado local + commit debounced (useDebouncedField): a tecla re-renderiza
// SÓ este box; o Dashboard inteiro (10+ seções) só depois da pausa. O campo
// da navbar ganhou o mesmo tratamento (NavSearchInput). INP p75 do campo era
// 1,3s no mobile, 665ms só de fila de main thread.
const VisitorSearchBox = ({ searchQuery, setSearchQuery }) => {
  const [localQuery, setLocalQuery] = useDebouncedField(searchQuery, setSearchQuery);
  return (
    <div className="mb-4 md:mb-6">
      <div className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
        <p className="text-sm font-semibold text-slate-200 mb-2">
          Pesquise um dorama no catálogo
        </p>

        <div className="flex items-center gap-2">
          <input
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Digite o nome do dorama…"
            className="w-full h-11 rounded-lg bg-slate-950/60 border border-slate-800 px-3 text-slate-100 placeholder:text-slate-500 outline-none focus:border-purple-500/60"
          />

          {localQuery?.trim() && (
            <Button
              type="button"
              variant="outline"
              className="h-11 bg-slate-950/60 border-slate-800 hover:bg-slate-900 text-slate-200"
              onClick={() => setLocalQuery("")}
            >
              Limpar
            </Button>
          )}
        </div>

        <p className="text-xs text-slate-400 mt-2">
          Dica: você pode explorar e pesquisar livremente. Para assistir, crie sua conta.
        </p>
      </div>
    </div>
  );
};

// ---------------- SECTION BLOCK (CARROSSEL COM SETAS) ----------------
// ✅ 13/08 (INP) — React.memo com comparador próprio: o LoAF da sonda v7
// mostrou o scheduler do React rodando fatias de render de 0,5-1,8s nos
// toques ruins — cada setDoramas/tecla re-renderizava as 10+ seções
// inteiras. Com memo, seção só re-renderiza quando OS DADOS DELA mudam.
// icon/title/onLoadMore ficam fora do comparador de propósito: icon é JSX
// recriado a cada render do pai (quebraria o memo) e o onLoadMore fica
// "fresco" porque toda mudança de doramas/hasMore/loadingMore re-renderiza.
const DoramaSection = React.memo(({
  title,
  icon,
  doramas,
  loading,
  error,
  id,
  hideDubladoBadge = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore = () => {},
}) => {
  const listRef = useRef(null);

  // ✅ 07/08 — cards mais compactos (referência: print do app "Dramio"
  // mandado pelo Leandro) pra caber mais fileira por tela e ficar com a
  // mesma "densidade" entre todas as categorias. Testado com tesagencia
  // antes; liberado geral (logado ou não) em 07/08.
  const compact = true;
  const cardWidthClass = compact
    ? "min-w-[104px] sm:min-w-[130px] md:min-w-[150px]"
    : "min-w-[150px] sm:min-w-[180px] md:min-w-[200px]";
  const rowGapClass = compact ? "gap-2.5" : "gap-4";

  const handleScroll = (direction) => {
    const container = listRef.current;
    if (!container) return;

    const amount = container.clientWidth * 0.8;
    const maxScroll = container.scrollWidth - container.clientWidth;

    if (direction === "left") {
      if (container.scrollLeft <= 0) {
        container.scrollTo({ left: maxScroll, behavior: "smooth" });
      } else {
        container.scrollBy({ left: -amount, behavior: "smooth" });
      }
    } else {
      if (container.scrollLeft >= maxScroll - 5) {
        container.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        container.scrollBy({ left: amount, behavior: "smooth" });
      }
    }
  };

  // ✅ 13/08 (sonda v6) — diário de branch da seção pro web_vitals_events:
  // cada troca skeleton/erro/vazio/fileira (e o desmonte total, ex. modo
  // busca) fica registrada com timestamp — o evento de CLS anexa isso e a
  // gente cruza com o horário exato de cada shift. Ver
  // [[project-web-vitals-rum-instrumentation]].
  const probeBranch =
    !loading && !error && (!doramas || doramas.length === 0)
      ? "null"
      : loading
        ? "skeleton"
        : error
          ? "error"
          : "rows";
  useEffect(() => {
    noteSectionState(id, probeBranch);
  }, [id, probeBranch]);
  useEffect(() => () => noteSectionState(id, "gone"), [id]);

  // Se veio vazio, não mostra seção (melhor que “erro”)
  if (!loading && !error && (!doramas || doramas.length === 0)) return null;

  return (
    <section
      id={id}
      // ✅ 13/08 (INP) — content-visibility:auto pula layout/paint das seções
      // fora da tela; contain-intrinsic-size "auto 340px" guarda a última
      // altura real renderizada (não cria shift — o min-h interno segura).
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 340px" }}
      className={
        compact ? "py-1.5 relative w-full" : "py-4 md:py-8 relative w-full"
      }
    >
      <div className={compact ? "flex items-center gap-2 mb-2" : "flex items-center gap-3 mb-4"}>
        {icon}
        <h2
          className={
            compact
              ? "text-lg md:text-xl font-bold text-white"
              : "text-2xl md:text-3xl font-bold text-white"
          }
        >
          {title}
        </h2>
      </div>

      {/* ✅ 11/08 — altura RESERVADA da fileira (medido: card = largura×1,5 +
          66px de texto + 16px pb; mobile 104px→238, sm 130px→277, md 150px→307).
          A telemetria real-user (web_vitals_events) provou que o conteúdo da
          fileira colapsa de 242px pra 0 e volta (recarrega/pisca), e cada
          colapso empurra ~700px = ~0,3 de CLS POR seção, ~7 seções = o 1,8-2,1
          da home. Com min-height, skeleton/vazio/real ocupam sempre o mesmo
          espaço → colapso não empurra mais nada. Ver [[project-web-vitals-rum-instrumentation]]. */}
      {/* ⚠️ 13/08 — `key` DIFERENTE em cada branch (skeleton/erro/fileira).
          A sonda v6 provou que CADA troca skeleton→fileira gerava um layout
          shift de ~0,3 cobrado pelo Chrome MESMO com o min-h segurando a
          altura: como os branches são <div> na mesma posição, o React
          REAPROVEITA o nó do DOM, e o Chrome trata o nó reciclado como
          "elemento que se moveu" (prevRect impossível, y=0). Com key própria
          o nó é recriado — elemento NOVO não gera shift por spec, e nada
          abaixo se move porque o min-h reserva o espaço. Era ISSO (×10
          seções em cascata) o grosso do CLS 0,7-1,8 da home. Ver
          [[project-web-vitals-rum-instrumentation]]. */}
      <div className="min-h-[238px] sm:min-h-[277px] md:min-h-[307px]">
      {loading ? (
        compact ? (
          // ✅ 07/08 — skeleton bate com o card compacto de verdade (fileira
          // horizontal, mesma largura/gap, com o bloco de texto reservado)
          // em vez do grid antigo só com o pôster — evita CLS na troca
          // loading → conteúdo real.
          <div key="skeleton" className={`flex ${rowGapClass} overflow-x-auto pb-4 no-scrollbar animate-pulse`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={cardWidthClass}>
                <div className="rounded-[12px] overflow-hidden">
                  <div className="aspect-[2/3] bg-slate-800" />
                  <div className="p-2 space-y-1">
                    <div className="h-[2.4em] bg-slate-800 rounded" />
                    <div className="h-3 w-1/2 bg-slate-800 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div key="skeleton" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] bg-slate-800 rounded-lg" />
            ))}
          </div>
        )
      ) : error ? (
        <div key="error" className="bg-slate-900 border border-red-500/30 text-red-400 p-6 rounded-lg text-center">
          <ServerCrash className="w-8 h-8 mx-auto mb-3" />
          Erro ao carregar esta seção.
        </div>
      ) : (
        <div key="rows" className="relative w-full">
          <div
            ref={listRef}
            className={`flex ${rowGapClass} overflow-x-auto pb-4 no-scrollbar`}
          >
            {doramas.map((d, index) => (
              <div key={d.id} className={cardWidthClass}>
                <DoramaCard dorama={d} index={index} hideYear hideDubladoBadge={hideDubladoBadge} />
              </div>
            ))}

            {hasMore && (
              <div className={cardWidthClass}>
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className={`w-full h-full ${compact ? "min-h-[160px]" : "min-h-[220px]"} flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 hover:bg-slate-800/60 hover:border-slate-600 transition-colors text-slate-300 text-sm font-medium disabled:opacity-60`}
                >
                  {loadingMore ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-6 h-6" />
                      Carregar mais
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {doramas.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => handleScroll("left")}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md transition absolute top-1/2 -translate-y-1/2 left-2 shadow-lg text-white z-20"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => handleScroll("right")}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md transition absolute top-1/2 -translate-y-1/2 right-2 shadow-lg text-white z-20"
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      )}
      </div>
    </section>
  );
}, (prev, next) =>
  prev.id === next.id &&
  prev.doramas === next.doramas &&
  prev.loading === next.loading &&
  prev.error === next.error &&
  prev.hasMore === next.hasMore &&
  prev.loadingMore === next.loadingMore &&
  prev.hideDubladoBadge === next.hideDubladoBadge
);

// ---------------- DASHBOARD PRINCIPAL ----------------
// ✅ 07/08 — "Continuar Assistindo" sai daqui pra quem está logado, porque
// virou a aba "Histórico" da barra inferior (BottomNav.jsx). Testado com
// tesagencia antes; liberado geral pra todo usuário logado em 07/08.
// ---------------- BANNER ROTATIVO DA HOME ----------------
// ✅ 16/08 (INP) — isolado do Dashboard: o setInterval de 10s re-renderiza
// SÓ este componente. `banners` vem memoizado do pai (useMemo), então o
// React.memo segura re-renders vindos de cima também.
const HomeBannerRotator = React.memo(function HomeBannerRotator({ banners, showBottomNav, paused = false }) {
  const [bannerIndex, setBannerIndex] = useState(0);

  useEffect(() => {
    // ✅ 20/08 (INP round 44) — pausa o rotate enquanto está escondido pela
    // busca (round 43): timer de slide invisível competindo com a digitação.
    if (paused || !banners || banners.length < 2) return;
    const id = setInterval(() => {
      setBannerIndex((i) => (i + 1) % banners.length);
    }, 10000);
    return () => clearInterval(id);
  }, [banners, paused]);

  if (!banners || banners.length === 0) return null;
  const banner = banners[bannerIndex % banners.length];
  const Icon = banner.icon;

  return (
    <div className={showBottomNav ? "mb-2 md:mb-3" : "mb-4 md:mb-6"}>
      <div className="group relative w-full rounded-xl">
        {/* brilho pulsante atrás do banner — muda de cor com o slide atual */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute -inset-0.5 rounded-xl bg-gradient-to-r ${banner.glow || "from-purple-600 via-fuchsia-500 to-pink-500"} opacity-70 blur-lg animate-pulse transition-colors duration-500`}
        />

        {/* conteúdo (alterna entre os banners) */}
        <div className="relative h-[84px] md:h-[96px] overflow-hidden rounded-xl">
          <AnimatePresence mode="wait">
            <motion.button
              key={bannerIndex}
              type="button"
              onClick={banner.onClick}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className={`absolute inset-0 flex items-center gap-3 rounded-xl bg-gradient-to-r ${banner.gradient || "from-purple-600 via-fuchsia-600 to-pink-600"} px-4 py-3 md:px-5 md:py-4 text-left ring-1 ring-white/20 shadow-lg shadow-black/20 focus:outline-none focus:ring-2 focus:ring-white/40`}
            >
              <span className="flex-1 min-w-0">
                <span className="block font-bold text-white text-base md:text-lg truncate">
                  {banner.title}
                </span>
                <span className="block text-sm text-white/90 mt-0.5 truncate">
                  {banner.subtitle}
                </span>
                {banner.note && (
                  <span className="block text-[11px] md:text-xs text-white/70 mt-0.5 truncate">
                    {banner.note}
                  </span>
                )}
              </span>

              <Icon className="w-5 h-5 shrink-0 text-white/90 transition-transform group-hover:translate-x-0.5" />
            </motion.button>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
});

// ✅ 15/08 (INP round 26) — searchQuery agora mora AQUI, não no App. Antes,
// cada commit da busca re-renderizava o App inteiro (providers, DoramasChat,
// BottomNav, InstallAppBanner, gates) e o Dashboard por prop; mesmo com as
// seções em `hidden` (7e24078b), essa reconciliação em cascata era o `V` de
// 1-1,7s que sobrou no LoAF. Só o Dashboard usa a busca — o Navbar recebe
// dele. Assinatura mantida com defaults pra não quebrar quem ainda passar prop.
const Dashboard = ({ searchQuery: _unusedQ, setSearchQuery: _unusedSet } = {}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation(); // ✅ (ADICIONADO) para capturar ?src=
  const showBottomNav = !!user;

  // ✅ (ADICIONADO) Pixel ID e chave do "dedupe" de Purchase
  const META_PIXEL_ID = "1424314778637167";
  const PURCHASE_SESSION_KEY = `dp_purchase_tracked_${META_PIXEL_ID}`;

  // ✅ (ADICIONADO) captura o parâmetro src (ex.: ?src=ads) e salva no localStorage
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(location.search);
      const src = (params.get("src") || "").trim().toLowerCase();
      if (src) {
        localStorage.setItem("dp_traffic_src", src);
        localStorage.setItem("dp_traffic_src_ts", String(Date.now()));
      }
    } catch {}
  }, [location.search]);

  const [doramas, setDoramas] = useState(() => {
    // ✅ 13/08 (LCP) — hero instantâneo: os destaques da última visita saem
    // do localStorage já no 1º render, e o fetch atualiza por trás. Junto
    // com o preload da imagem no main.jsx, a revisita pinta o hero sem
    // esperar JS+React+fetch (renderDelay era 1,6s no p75). O HeroSection
    // regrava o cache toda vez que o featured muda.
    let cachedFeatured = [];
    try {
      const raw = localStorage.getItem("dp_featured_cache");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) cachedFeatured = parsed.slice(0, 6);
    } catch {
      /* cache corrompido = ignora */
    }
    return {
    featured: cachedFeatured,
    new: [],
    recommended: [],
    dubbed: [],
    baby: [],
    taboo: [],
    hidden: [],
    lobos_vampiros: [],
    bl_gl: [],
    brasileiro: [],
    anime: [],
    };
  });

  const [loading, setLoading] = useState({
    featured: true,
    new: true,
    recommended: true,
    dubbed: true,
    baby: true,
    taboo: true,
    hidden: true,
    lobos_vampiros: true,
    bl_gl: true,
    brasileiro: true,
    anime: true,
  });

  const [error, setError] = useState({
    featured: false,
    new: false,
    recommended: false,
    dubbed: false,
    baby: false,
    taboo: false,
    hidden: false,
    lobos_vampiros: false,
    bl_gl: false,
    brasileiro: false,
    anime: false,
  });

  // ✅ "Carregar mais" nas fileiras da home — hasMore/loadingMore por
  // categoria (featured não entra, é só o banner, não pagina)
  const [hasMore, setHasMore] = useState({
    new: false,
    recommended: false,
    dubbed: false,
    baby: false,
    taboo: false,
    hidden: false,
    lobos_vampiros: false,
    bl_gl: false,
    brasileiro: false,
    anime: false,
  });
  const [loadingMore, setLoadingMore] = useState({});

  const [continueWatching, setContinueWatching] = useState([]);
  const [loadingContinue, setLoadingContinue] = useState(true);

  // ✅ (NOVO) estado da busca REAL no banco
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  // ✅ 14/08 (INP round 24, a pedido do Stefano: "o certo é tá certo até em
  // horário de pico") — a busca desenha no máximo 24 cards de primeira; o
  // resto entra pelo botão "Mostrar mais". O LoAF mostrou chunks de 1,0-1,2s
  // em celular fraco = volume do grid (até 80+ cards de uma vez).
  const SEARCH_RENDER_CAP = 24;
  const [searchShowAll, setSearchShowAll] = useState(false);
  // ✅ 18/08 (CLS) — chave do CONJUNTO de resultados: quando a busca nova
  // chega, o grid é remontado (nós novos não contam como layout shift) em
  // vez de reposicionar os cards existentes. Manter o grid montado durante
  // o loading (0963dc44) foi ótimo pro INP, mas os cards antigos se MOVIAM
  // quando o resultado novo chegava (>500ms após a tecla = fora da janela
  // que o Chrome ignora): CLS home 0,08 → 0,137 (vítima `div.dp-card-in`).
  // Só muda quando o conjunto muda — digitar sem alterar resultado não remonta.
  const searchGridKey = useMemo(
    () => searchResults.map((d) => d.id).join("|"),
    [searchResults]
  );
  // ✅ 18/08 (INP round 36) — grid de resultados em DUAS levas. O LoAF do
  // carimbo 43c98575 (teclado na busca, p75 488ms, inputDelay 212ms) mostrou
  // o commit do scheduler ("V" via MessagePort) de 464ms a 1,6s entre uma
  // tecla e outra: são os 24 cards remontados de uma vez (o `key` acima é o
  // que segura o CLS, então não sai). Agora a resposta nova monta só os 8
  // primeiros (1 tela de celular); os outros 16 entram no idle seguinte,
  // como nós NOVOS embaixo (não movem nada = zero CLS). Chaveado pelo
  // conjunto: resposta nova volta pra 1ª leva sozinha.
  const SEARCH_FIRST_WAVE = 8;
  const [searchFullWaveKey, setSearchFullWaveKey] = useState("");
  const searchFullWave = searchFullWaveKey === searchGridKey;
  useEffect(() => {
    if (!searchGridKey || searchResults.length <= SEARCH_FIRST_WAVE) return;
    const fire = () => startTransition(() => setSearchFullWaveKey(searchGridKey));
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(fire, { timeout: 700 });
      return () => cancelIdleCallback(id);
    }
    const t = setTimeout(fire, 250);
    return () => clearTimeout(t);
  }, [searchGridKey, searchResults.length]);

  // (17/08) O índice local do Fuse pra typo saiu daqui — fallback de typo
  // agora é a RPC search_doramas_typo no banco. Ver efeito da busca abaixo.

  // ✅ refs e scroll para "Continuar Assistindo" (setas iguais às outras)
  const continueRef = useRef(null);

  const handleScrollContinue = (direction) => {
    const container = continueRef.current;
    if (!container) return;

    const amount = container.clientWidth * 0.8;
    const maxScroll = container.scrollWidth - container.clientWidth;

    if (direction === "left") {
      if (container.scrollLeft <= 0) {
        container.scrollTo({ left: maxScroll, behavior: "smooth" });
      } else {
        container.scrollBy({ left: -amount, behavior: "smooth" });
      }
    } else {
      if (container.scrollLeft >= maxScroll - 5) {
        container.scrollTo({ left: 0, behavior: "smooth" });
      } else {
        container.scrollBy({ left: amount, behavior: "smooth" });
      }
    }
  };

  // ✅ (NOVO) "Assine agora" só pra quem NUNCA foi assinante
  const [checkingEverSubscribed, setCheckingEverSubscribed] = useState(false);
  const [neverSubscribed, setNeverSubscribed] = useState(false);

  const PLANS_URL = "https://doramasplus.com.br/plans";

  // ✅ (ALTERAÇÃO NECESSÁRIA) mantém tudo igual, só acrescenta ?src=ads quando o tráfego veio de ads
  const goPlans = () => {
    try {
      const src = (localStorage.getItem("dp_traffic_src") || "").trim().toLowerCase();
      if (src === "ads") {
        window.location.href = `${PLANS_URL}?src=ads`;
        return;
      }
    } catch {}
    window.location.href = PLANS_URL;
  };

  useEffect(() => {
    const checkEverSubscribed = async () => {
      try {
        if (authLoading || !user) {
          setNeverSubscribed(false);
          setCheckingEverSubscribed(false);
          return;
        }

        setCheckingEverSubscribed(true);

        // Se existir qualquer registro na subscriptions pra esse user, então já foi assinante
        const { data, error } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("[subscriptions] erro ao checar histórico:", error);
          // Em caso de erro, melhor NÃO mostrar o botão pra evitar falso positivo
          setNeverSubscribed(false);
          return;
        }

        // data null => nunca teve assinatura
        setNeverSubscribed(!data);
      } catch (e) {
        console.error("[subscriptions] exception ao checar histórico:", e);
        setNeverSubscribed(false);
      } finally {
        setCheckingEverSubscribed(false);
      }
    };

    checkEverSubscribed();
  }, [authLoading, user]);

  // ✅✅✅ ALTERAÇÃO ÚNICA: REMOVIDO Purchase do FRONT (não mexe em mais nada)
  useEffect(() => {
    const trackPurchaseIfActive = async () => {
      try {
        if (typeof window === "undefined") return;
        if (authLoading || !user) return;

        // evita duplicar na mesma sessão
        if (sessionStorage.getItem(PURCHASE_SESSION_KEY) === "1") return;

        // pega a última assinatura do usuário
        const { data, error } = await supabase
          .from("subscriptions")
          .select(
            "id,status,plan_name,price_id,provider,provider_ref,order_nsu,created_at"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("[purchase] erro ao checar subscription:", error);
          return;
        }

        if (!data) return;

        const status = String(data.status || "").toLowerCase();
        const isPaid = status === "active";

        if (!isPaid) return;

        // ❌ NÃO dispara Purchase no FRONT (Purchase fica SOMENTE no BACKEND/CAPI)
        // Mantém apenas a marcação local pra não ficar reconsultando toda hora.
        sessionStorage.setItem(PURCHASE_SESSION_KEY, "1");
      } catch (e) {
        console.error("[purchase] exception:", e);
      }
    };

    trackPurchaseIfActive();
  }, [authLoading, user, PURCHASE_SESSION_KEY]);

  const fetchCategory = useCallback(async (category, buildQueryFn, limit) => {
    setLoading((prev) => ({ ...prev, [category]: true }));
    setError((prev) => ({ ...prev, [category]: false }));

    const { data, error: err } = await runQueryWithFallback((selectStr) =>
      buildQueryFn(selectStr).limit(limit)
    );

    if (err) {
      console.error(`[${category}] erro:`, err);
      // se for erro de coluna faltando, não marca como erro (só fica vazio)
      if (!isMissingColumnError(err)) {
        setError((prev) => ({ ...prev, [category]: true }));
      }
    }

    // ✅ 12/08 — erro NÃO apaga o que a fileira já tinha (data null → []
    // esvaziava a categoria e a seção inteira sumia via return null =
    // shift de ~0,3 POR seção; em rede móvel instável — exatamente o
    // público com CLS ruim — fetch falha toda hora). Telemetria:
    // web_vitals_events, fileiras colapsando prev_h~280 → 0.
    // ✅ 16/08 (INP round 30) — o commit de dados de cada fileira era URGENTE
    // (setState após await = síncrono). As fileiras chegam em ondas de 3, e
    // cada onda = 3 seções × ~20 cards com motion = o `V` de 800-1700ms que
    // o LoAF mostrou nos primeiros 2-30s da home (a maioria dos toques ruins
    // é nessa janela: cliente toca enquanto a home ainda monta). Como
    // TRANSIÇÃO, um toque interrompe o commit da fileira e é atendido antes;
    // a fileira termina de montar logo depois. Só o `featured` (hero = LCP)
    // continua urgente: precisa pintar o mais cedo possível.
    const commit = () => {
      setDoramas((prev) => ({
        ...prev,
        [category]: data || prev[category] || [],
      }));
      if (CATEGORY_QUERIES[category]) {
        setHasMore((prev) => ({ ...prev, [category]: (data || []).length === limit }));
      }
      setLoading((prev) => ({ ...prev, [category]: false }));
    };
    if (category === "featured") commit();
    else startTransition(commit);
  }, []);

  // ✅ "Carregar mais" na fileira da home — pega a partir de onde já carregou
  // (doramas[category].length vira o offset) e concatena no que já tem.
  const loadMoreCategory = async (category) => {
    const cfg = CATEGORY_QUERIES[category];
    if (!cfg || loadingMore[category] || !hasMore[category]) return;

    setLoadingMore((prev) => ({ ...prev, [category]: true }));

    const offset = doramas[category]?.length || 0;
    const { data, error: err } = await runQueryWithFallback((selectStr) =>
      cfg.build(selectStr).range(offset, offset + cfg.limit - 1)
    );

    if (err) {
      console.error(`[${category}] load_more erro:`, err);
    } else {
      setDoramas((prev) => ({ ...prev, [category]: [...(prev[category] || []), ...data] }));
      setHasMore((prev) => ({ ...prev, [category]: data.length === cfg.limit }));
    }
    setLoadingMore((prev) => ({ ...prev, [category]: false }));
  };

  // Carregar categorias
  // ✅ 13/08 (LCP) — SEM esperar o authLoading: as queries de catálogo não
  // dependem de usuário, e o gate atrasava o fetch do hero (e de tudo) nos
  // ~2-3s que o auth leva em celular lento — era boa parte do renderDelay
  // de 1,6s do LCP. fetchCategory é useCallback([]) estável, então o efeito
  // roda UMA vez no mount.
  // ✅ 13/08 (2ª calibragem) — só o DESTAQUE busca no mount. As fileiras
  // esperam load da página + featured resolvido + idle, e carregam em levas
  // de 3: os ~10 fetches simultâneos competiam com o download da imagem do
  // hero (LCP 1ª visita 2480→4676ms no carimbo 272ca722) e o render em
  // cascata das seções caía em cima dos primeiros toques (INP 368→622ms).
  useEffect(() => {
    let cancelled = false;
    let started = false;

    const featuredPromise = fetchCategory(
      "featured",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("is_featured", true)
          .order("created_at", { ascending: false }),
      10
    );

    const startRows = async () => {
      if (started || cancelled) return;
      started = true;
      const entries = Object.entries(CATEGORY_QUERIES);
      for (let i = 0; i < entries.length && !cancelled; i += 3) {
        await Promise.all(
          entries
            .slice(i, i + 3)
            .map(([key, cfg]) => fetchCategory(key, cfg.build, cfg.limit))
        );
      }
    };

    const whenIdle = () => {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(() => startRows(), { timeout: 1500 });
      } else {
        setTimeout(startRows, 200);
      }
    };

    const onLoad = () => {
      featuredPromise.finally(whenIdle);
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }
    // Rede/evento nunca pode segurar as fileiras pra sempre
    const safety = setTimeout(startRows, 4000);

    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
      clearTimeout(safety);
    };
  }, [fetchCategory]);

  // ✅ BUSCA: RPC search_doramas_ranked (ILIKE + ranking por word_similarity
  // no banco, pg_trgm) + RPC search_doramas_typo como fallback de typo (0
  // resultado) — tudo no banco desde 17/08 (era Fuse.js no cliente).
  // Antes: ILIKE solto (até 80 resultados sem ordem nenhuma do banco) +
  // Fuse.js reordenando por cima — com o catálogo grande isso enterrava o
  // título certo no meio de matches fracos (só bateu na descrição, por
  // exemplo). Agora o banco já entrega ordenado por relevância real.
  useEffect(() => {
    const q = (searchQuery || "").trim();

    if (q.length < 2) {
      // Limpar a busca devolve as fileiras da home (render grande) — transição.
      startTransition(() => {
        setSearchResults([]);
        setSearchLoading(false);
        setSearchError(false);
      });
      return;
    }

    let isCancelled = false;
    // ✅ 17/08 (INP round 33) — flags de loading/erro/cap em transição: são
    // só indicador visual, não precisam de commit urgente. Antes eram 3
    // setState síncronos por tecla = render urgente do Dashboard inteiro
    // enquanto a próxima tecla chegava (inputDelay 368ms no teclado).
    startTransition(() => {
      setSearchLoading(true);
      setSearchError(false);
      // Consulta nova volta pro cap de 24 cards (o "Mostrar mais" é por busca)
      setSearchShowAll(false);
    });

    const timer = setTimeout(async () => {
      try {
        const { data, error: err } = await runQueryWithFallback((selectStr) =>
          supabase.rpc("search_doramas_ranked", { search_query: q }).select(selectStr)
        );

        if (isCancelled) return;

        if (err) {
          console.error("[search] erro:", err);
          startTransition(() => {
            setSearchError(true);
            setSearchResults([]);
          });
          return;
        }

        const dbResults = data || [];

        if (dbResults.length > 0) {
          // Banco já veio ordenado por relevância — usa direto.
          // ✅ 14/08 (INP round 22) — startTransition: o commit dos resultados
          // chega de um callback async, fora da transição do debounce, e o
          // render do grid rodava em bloco único de ~1,6s no scheduler
          // (LoAF: "V" via MessagePort.onmessage) segurando a tecla seguinte
          // (inputDelay 1,3-1,7s). Como transição, a tecla nova interrompe.
          startTransition(() => setSearchResults(dbResults));
        } else {
          // Banco não encontrou nada — fallback de typo TAMBÉM no banco
          // (pg_trgm similarity, RPC search_doramas_typo).
          // ✅ 17/08 (INP round 33) — era Fuse.js sobre um índice de 3,2k
          // títulos baixado + parseado na thread principal do celular na 1ª
          // tecla (LoAF Response.text.then ~600ms = inputDelay da tecla
          // seguinte). Agora zero download/parse no cliente e fuse.js fora
          // do bundle.
          const { data: typoData } = await runQueryWithFallback((selectStr) =>
            supabase.rpc("search_doramas_typo", { search_query: q }).select(selectStr)
          );
          if (isCancelled) return;
          startTransition(() => setSearchResults(typoData || []));
        }
      } catch (e) {
        if (isCancelled) return;
        console.error("[search] exception:", e);
        startTransition(() => {
          setSearchError(true);
          setSearchResults([]);
        });
      } finally {
        // ✅ 18/08 (INP round 36) — era o ÚNICO setState urgente que sobrava
        // por busca: re-render urgente do Dashboard inteiro por resposta,
        // competindo com a tecla seguinte. É só indicador visual → transição.
        if (!isCancelled) startTransition(() => setSearchLoading(false));
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Carregar continuar assistindo (2 queries leves)
  useEffect(() => {
    const loadHistory = async () => {
      try {
        if (authLoading || !user) {
          setContinueWatching([]);
          setLoadingContinue(false);
          return;
        }

        const { data: history, error: historyError } = await supabase
          .from("watch_history")
          .select("dorama_id,episode,current_time,duration,finished,updated_at")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(30);

        if (historyError) throw historyError;

        if (!history || history.length === 0) {
          setContinueWatching([]);
          setLoadingContinue(false);
          return;
        }

        const ids = [...new Set(history.map((h) => h.dorama_id))];

        const { data: doramasData, error: doramasErr } =
          await runQueryWithFallback((selectStr) =>
            supabase.from("doramas").select(selectStr).in("id", ids)
          );

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
              banner_url: dorama.banner_url,
              cover_url: dorama.cover_url,
              thumbnail_url: dorama.thumbnail_url,

              bunny_url: dorama.bunny_url || null,
              bunny_stream_url: dorama.bunny_stream_url || null,

              episode: progress.episode,
              current_time: progress.current_time,
              duration: progress.duration,
              finished: progress.finished,
            };
          })
          .filter(Boolean);

        setContinueWatching(merged);
      } catch (e) {
        console.error("Erro ao carregar watch_history:", e);
        setContinueWatching([]);
      } finally {
        setLoadingContinue(false);
      }
    };

    loadHistory();
  }, [authLoading, user]);

  // ✅ 20/08 (INP round 45): busca só com 2+ caracteres — a 1ª letra
  // disparava RPC + troca home<->resultados pra nada (padrão da indústria:
  // min 2 chars). Com 1 letra a home fica intacta e ZERO trabalho roda.
  const _nq = (searchQuery || "").trim().toLowerCase();
  const normalizedQuery = _nq.length >= 2 ? _nq : "";

  // ✅ 13/08 (sonda v6) — a busca ativa desmonta banner+hero+seções (os
  // `!normalizedQuery &&` abaixo). Registra o liga/desliga com timestamp pra
  // cruzar com o horário dos shifts (suspeita nº 11 da caçada ao CLS).
  useEffect(() => {
    noteSearchState(!!normalizedQuery);
  }, [normalizedQuery]);

  const communityLink = "https://chat.whatsapp.com/Kp6dQuElfhrHWeuv1qUwtR";

  const goCommunity = useCallback(() => {
    window.open(communityLink, "_blank", "noopener,noreferrer");
  }, [communityLink]);

  // ✅ 27/07: no Android, troca o slide da Dora por "baixar o app oficial"
  // (Play Store, agora com o assetlinks.json corrigido) — no iPhone não tem
  // Play Store, então mantém a Dora normal ali. O rodapé (InstallAppBanner)
  // não muda pro iOS, continua só a instrução de tela de início.
  // ✅ 12/08 (noite) — palpite SÍNCRONO de login: presença do token supabase
  // no localStorage (leitura instantânea). A sonda provou que 92% dos shifts
  // ruins eram o topo da página do VISITANTE nascendo ~3s atrasado (+172px):
  // os blocos de visitante esperavam o authLoading resolver. Agora o 1º frame
  // já decide certo pra ~100% dos casos: com token = trata como logado; sem
  // token = visitante, blocos aparecem DESDE O INÍCIO, sem inserção tardia.
  // Quando o auth resolve de verdade, a condição passa a usar o user real.
  // ⚠️ 13/08 — a chave REAL é "sb-auth-token" (customSupabaseClient.js define
  // storageKey explícito, NÃO usa o padrão sb-<ref>-auth-token). Com a chave
  // errada, todo LOGADO era tratado como visitante no 1º frame: a caixa de
  // busca nascia e sumia ~2s depois quando o auth resolvia = o shift de
  // ~154px que a sonda v6 pegou (e o `logged` da telemetria mentia junto).
  const likelyLogged = (() => {
    try {
      return !!localStorage.getItem("sb-auth-token");
    } catch {
      return false;
    }
  })();
  const showVisitorBlocks = authLoading ? !likelyLogged : !user;

  const isAndroidDevice =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

  // ✅ 12/08 — banner do app pro logado (ver JSX mais abaixo). Decisão
  // SÍNCRONA no primeiro render (sem CLS): Android + fora do app oficial +
  // cooldown de 24h respeitado. O caso "já instalou pela loja mas abriu o
  // site no navegador" é detectado async (getInstalledRelatedApps) e só
  // ESCONDE — nunca insere depois.
  const APP_INVITE_DISMISS_KEY = "dp_app_invite_dismissed_at";
  const [showAppInvite, setShowAppInvite] = useState(() => {
    try {
      if (!isAndroidDevice) return false;
      // dentro do app oficial (TWA) ou de atalho standalone não faz sentido
      if (window.matchMedia("(display-mode: standalone)").matches) return false;
      if (document.referrer.startsWith("android-app://br.com.doramasplus.twa")) return false;
      const dismissedAt = Number(localStorage.getItem(APP_INVITE_DISMISS_KEY) || 0);
      if (dismissedAt && Date.now() - dismissedAt < 24 * 60 * 60 * 1000) return false;
      return true;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!showAppInvite || typeof navigator === "undefined" || !navigator.getInstalledRelatedApps) return;
    let cancelled = false;
    navigator
      .getInstalledRelatedApps()
      .then((apps) => {
        if (!cancelled && apps.length > 0) setShowAppInvite(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showAppInvite]);

  const dismissAppInvite = () => {
    try {
      localStorage.setItem(APP_INVITE_DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShowAppInvite(false);
  };

  // Carrossel de banners no topo da home (alterna a cada 5s)
  // ✅ 27/07: slide do app (Android) / Dora (iPhone) vem primeiro agora —
  // era o último, pedido pra dar mais destaque pro app.
  // ✅ 16/08 (INP) — memoizado: referência estável pro React.memo do
  // HomeBannerRotator segurar (senão o array literal novo a cada render
  // do Dashboard furaria o memo).
  const homeBanners = useMemo(() => [
    // ✅ 07/08 — TESTE: pro tesagencia, slide "Pedir um dorama" vem primeiro
    // de todos — mais visível que um ícone no topo, pra gente parar de
    // levar pedido pelo WhatsApp.
    ...(showBottomNav
      ? [
          {
            icon: Send,
            title: "🎬 Não achou seu dorama?",
            subtitle: "Peça aqui agora",
            gradient: "from-purple-600 via-fuchsia-600 to-pink-600",
            glow: "from-purple-600 via-fuchsia-500 to-pink-500",
            onClick: () => navigate("/minha-conta"),
          },
        ]
      : []),
    isAndroidDevice
      ? {
          icon: Smartphone,
          title: "📲 Baixe o app oficial no Play Store",
          subtitle: "Mais rápido e direto na tela inicial, sem passar pelo navegador",
          gradient: "from-blue-600 via-indigo-600 to-purple-600",
          glow: "from-blue-600 via-indigo-500 to-purple-600",
          onClick: () =>
            window.open(playStoreUrl("carrossel-home"), "_blank", "noopener,noreferrer"),
        }
      : {
          icon: Bot,
          title: "🤖 Dúvidas? Fale com a Dora",
          subtitle: "Nossa assistente virtual responde na hora, qualquer horário",
          gradient: "from-blue-600 via-indigo-600 to-purple-600",
          glow: "from-blue-600 via-indigo-500 to-purple-600",
          onClick: () => window.dispatchEvent(new Event("open-dora-chat")),
        },
    {
      icon: ExternalLink,
      title: "💬 Entre no Grupo VIP do Whatsapp",
      subtitle: "Séries em alta, novidades e promoções exclusivas",
      gradient: "from-green-700 via-green-600 to-lime-500",
      glow: "from-green-700 via-green-500 to-lime-500",
      onClick: goCommunity,
    },
    {
      icon: Gift,
      title: "🎁 Indique e ganhe 15 dias grátis",
      subtitle: "A cada amigo que assinar pelo seu link, você ganha +15 dias",
      note: "Necessário ter assinado pelo menos uma vez",
      gradient: "from-pink-600 via-red-500 to-orange-500",
      glow: "from-pink-600 via-red-500 to-orange-500",
      onClick: () =>
        navigate(user ? "/indicar" : "/login?redirect=/indicar"),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [showBottomNav, isAndroidDevice, user, navigate, goCommunity]);

  return (
    <>
      <Helmet>
        <title>Catálogo - DoramasPlus</title>
      </Helmet>

      <Navbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />

      <SelectedTesterModal />

      <main
        className={`container mx-auto px-4 sm:px-6 lg:px-8 ${
          showBottomNav ? "pb-20" : ""
        }`}
        style={
          // ✅ 07/08 — usa a altura real do nav (mede via ResizeObserver em
          // Navbar.jsx) em vez de um px fixo chutado, que não cobria o caso
          // da faixa vermelha de renovação empurrando o nav pra baixo.
          // ✅ 12/08 — MESMA fórmula pra visitante e logado: antes o visitante
          // usava pt-[100px] fixo e o logado calc(nav+12px); como todo mundo
          // começa como "visitante" até o auth resolver, o padding pulava
          // ~24px no flip e empurrava a página inteira (CLS pego pela
          // telemetria, loadState=complete). Ver
          // [[project-web-vitals-rum-instrumentation]].
          { paddingTop: "calc(var(--dp-navbar-h, 64px) + 12px)" }
        }
      >
        {/* ✅ 11/08 — o banner "Assine agora" (pra logado que nunca assinou)
            SAIU daqui de cima. Ele só aparece depois de uma consulta async ao
            Supabase (checkEverSubscribed); nascendo acima do hero, empurrava a
            página inteira pra baixo quando chegava = CLS de corpo inteiro
            (loadState "complete", confirmado por web_vitals_events). Agora
            renderiza LOGO ABAIXO do hero (ver mais pra frente), onde o hero e o
            topo da tela não se mexem e ele só empurra o que já está abaixo da
            dobra. Ver [[project-web-vitals-rum-instrumentation]]. */}

        {/* ✅ NOVO: barra de busca para NÃO logado (não duplica para logado) */}
        {/* ✅ 12/08 (noite) — showVisitorBlocks decide no 1º FRAME via token
            do localStorage: nem o logado vê a caixa piscar, nem o visitante
            espera 3s pra ela nascer empurrando a página (os 92% da sonda). */}
        {showVisitorBlocks && (
          <VisitorSearchBox
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
        )}

        {/* ✅ Carrossel de banners — logo abaixo da busca, acima do banner principal */}
        {/* ✅ 16/08 (INP round 29) — banner rotativo isolado no próprio
            componente: o bannerIndex morava aqui no Dashboard e trocava a cada
            10s, re-renderizando o Dashboard INTEIRO (navbar, hero, 10 seções,
            busca) só pra trocar um slide — um toque que caísse nessa janela
            pagava esse commit (LoAF: `V` de ~300ms sem alvo). Agora o timer e
            o índice vivem dentro do HomeBannerRotator (memo). */}
        {/* ✅ 19/08 (INP round 43) — hero + banners também NÃO desmontam mais
            na busca (mesmo padrão da round 25, que já salvou as 10 fileiras):
            o 1º commit do debounce desmontava HomeBannerRotator + HeroSection
            (65svh de imagem) + banners promo, e limpar a busca remontava tudo
            — commit síncrono gigante que caía entre a tecla e o paint
            (teclado na busca: p75 272ms, presentation 174). Com `hidden`, a
            árvore sobrevive e o liga/desliga da busca vira mudança de CSS. */}
        <div hidden={!!normalizedQuery}>
        <HomeBannerRotator banners={homeBanners} showBottomNav={showBottomNav} paused={!!normalizedQuery} />

        {/* ✅ 12/08 (blindagem CLS) — SLOT de altura fixa pro hero, presente
            desde o 1º frame em qualquer estado (carregando/vazio/pronto).
            A telemetria mostrou fileiras sendo empurradas ~430px (≈65svh)
            pra baixo aos ~2,4s do load puro: alguma transição de estado do
            hero muda o tamanho dele. Com o slot fixo por fora, o que
            acontece DENTRO nunca mais empurra o resto da página. */}
        <div className="h-[65svh] md:h-[70svh] mb-6 md:mb-8 overflow-hidden">
          <HeroSection
            featuredDoramas={doramas.featured}
            loading={loading.featured}
            paused={!!normalizedQuery}
          />
        </div>

        {/* ✅ 11/08 — "Assine agora" (logado que nunca assinou) movido pra CÁ,
            logo abaixo do hero. Aparece tarde (após checkEverSubscribed), então
            fica abaixo da dobra e não empurra o hero/topo = quase zero CLS. */}
        {user && neverSubscribed && !checkingEverSubscribed && (
          <div className="mb-4 md:mb-6">
            <div className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 md:px-5 md:py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-200">
                    Assine agora e libere o acesso completo ✅
                  </p>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Você já tem conta. Falta só assinar para assistir sem limites.
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={goPlans}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  Assine agora <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ✅ 12/08 — convite dedicado do APP pro usuário logado no Android
            que ainda não está no app oficial. Motivo: desde 07/08 o banner
            do rodapé some pro logado (barra inferior), então justamente o
            assinante não via convite nenhum — só 161 de 2085 com push.
            CLS-safe: a decisão de aparecer é SÍNCRONA (Android + logado +
            cooldown via localStorage), presente desde o 1º frame; só o caso
            raro "já tem o app" esconde depois (checagem async ~ms).
            Fechou? Volta em 24h (pedido do Stefano: insistir até instalar). */}
        {user && showAppInvite && (
          <div className="mb-4 md:mb-6">
            <div className="w-full rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 md:px-5 md:py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-indigo-200">
                    📲 Leve seus doramas com você
                  </p>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Baixe o app oficial: abre direto da tela inicial, mais
                    rápido e com aviso de dorama novo.
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    onClick={() =>
                      window.open(playStoreUrl("banner-assinante"), "_blank", "noopener,noreferrer")
                    }
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                  >
                    Baixar grátis <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  <button
                    type="button"
                    onClick={dismissAppInvite}
                    aria-label="Fechar"
                    className="text-slate-400 hover:text-slate-200 px-1.5 py-1 text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        </div>

        {/* ✅ BUSCA (agora é do BANCO, não das categorias) */}
        {normalizedQuery && (
          <section className="py-4 md:py-6">
            {/* ✅ 17/08 (CLS) — cabeçalho da busca com geometria FIXA: no
                mobile o título longo quebrava em 2 linhas e o contador
                ("Buscando..." ↔ "30 encontrados") mudava de largura a cada
                busca, re-quebrando a linha e empurrando o grid (shifts de
                0,08-0,18 em text-purple-400 / text-sm text-slate-400 na
                telemetria). Agora: título em 1 linha com truncate, contador
                com largura mínima reservada e sem encolher, linha com min-h. */}
            <div className="flex items-center justify-between gap-3 mb-3 min-h-[2.25rem]">
              <h2 className="text-xl md:text-2xl font-bold text-white truncate min-w-0">
                Resultados para:{" "}
                <span className="text-purple-400">"{searchQuery}"</span>
              </h2>

              <span className="text-sm text-slate-400 shrink-0 min-w-[7.5rem] text-right tabular-nums">
                {searchLoading
                  ? "Buscando..."
                  : `${searchResults.length} encontrado${
                      searchResults.length === 1 ? "" : "s"
                    }`}
              </span>
            </div>

            {/* ✅ 17/08 (INP round 33) — resultados anteriores FICAM montados
                enquanto a busca nova roda (o contador acima já diz
                "Buscando..."). Antes, cada tecla desmontava o grid inteiro
                (24 cards + 24 imagens) e remontava ~300ms depois = as "27 IMG
                mutations por tecla" vistas ao vivo, layout+decode+paint em
                celular fraco (presentation 130-250ms). Só mostra o texto de
                "procurando" quando ainda não existe resultado nenhum. */}
            {searchLoading && searchResults.length === 0 ? (
              <p className="text-sm text-slate-400">Procurando no catálogo...</p>
            ) : searchError ? (
              <p className="text-sm text-red-400">
                Erro ao buscar. Tente novamente.
              </p>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-slate-400">
                Nenhum dorama encontrado com esse termo. Tente outra palavra.
              </p>
            ) : (
              <>
                <div key={searchGridKey} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {(searchShowAll
                    ? searchResults
                    : searchResults.slice(
                        0,
                        searchFullWave ? SEARCH_RENDER_CAP : SEARCH_FIRST_WAVE
                      )
                  ).map((dorama, index) => (
                    <DoramaCard key={dorama.id} dorama={dorama} index={index} hideYear />
                  ))}
                </div>
                {!searchShowAll && searchFullWave && searchResults.length > SEARCH_RENDER_CAP && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={() => startTransition(() => setSearchShowAll(true))}
                      className="px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-semibold transition-colors"
                    >
                      Mostrar mais {searchResults.length - SEARCH_RENDER_CAP} resultado
                      {searchResults.length - SEARCH_RENDER_CAP === 1 ? "" : "s"}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* CONTINUAR ASSISTINDO — pro tesagencia isso virou a aba Histórico */}
        {/* ✅ 12/08 (noite) — mesma regra do 1º frame da caixa de busca:
            visitante vê desde o início, logado nunca vê piscar. */}
        {/* ✅ 19/08 (INP round 43) — idem: não desmonta mais na busca */}
        {showVisitorBlocks && (
          <section hidden={!!normalizedQuery} className="py-4 md:py-6 relative w-full">
            <div className="flex items-center gap-2 mb-3">
              <Play className="w-5 h-5 text-purple-400" />
              <h2 className="text-xl md:text-2xl font-bold">
                Continuar Assistindo
              </h2>
            </div>

            {loadingContinue ? (
              <p className="text-sm text-slate-400">
                Carregando seu histórico...
              </p>
            ) : continueWatching.length === 0 ? (
              <p className="text-sm text-slate-500">
                Você ainda não começou nenhum dorama.
              </p>
            ) : (
              <div className="relative w-full">
                <div
                  ref={continueRef}
                  className="flex gap-4 overflow-x-auto pb-2 no-scrollbar"
                >
                  {continueWatching.map((item) => {
                    const thumb = item.thumbnail_url || item.cover_url || "";

                    const progress =
                      item.duration > 0
                        ? Math.min(
                            (item.current_time / item.duration) * 100,
                            100
                          )
                        : 0;

                    return (
                      <button
                        key={`${item.dorama_id}-${item.episode}`}
                        onClick={() => navigate(`/dorama/${item.slug}/watch`)}
                        className="min-w-[150px] max-w-[180px] bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex-shrink-0 hover:border-purple-500/70 hover:bg-slate-800/80 transition-colors"
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

                        <div className="p-3 space-y-1 text-left">
                          <p className="text-sm font-medium line-clamp-2">
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
                                {item.finished
                                  ? "Concluído"
                                  : "Retomar de onde parou"}
                              </p>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {continueWatching.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleScrollContinue("left")}
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md transition absolute top-1/2 -translate-y-1/2 left-2 shadow-lg text-white z-20"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleScrollContinue("right")}
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md transition absolute top-1/2 -translate-y-1/2 right-2 shadow-lg text-white z-20"
                    >
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* ✅ 15/08 (INP round 25) — as 10 fileiras NÃO desmontam mais na
            busca: ficam escondidas via `hidden`. Desmontar+remontar centenas
            de cards a cada busca/limpar era o bloco `V` de 1-3s do scheduler
            que sobrou depois do cap de 24 (LoAF, carimbo e1e9e45e). Com
            hidden, a árvore + o React.memo das seções sobrevivem intactos. */}
        <div hidden={!!normalizedQuery}>
          <DoramaSection
            id="novos"
            title="Novos Lançamentos"
            icon={<Sparkles className="w-6 h-6 text-purple-400" />}
            doramas={doramas.new}
            loading={loading.new}
            error={error.new}
            hasMore={hasMore.new}
            loadingMore={loadingMore.new}
            onLoadMore={() => loadMoreCategory("new")}
          />

          <DoramaSection
            id="dublados"
            title="Séries Dubladas"
            icon={<Globe className="w-6 h-6 text-blue-400" />}
            doramas={doramas.dubbed}
            loading={loading.dubbed}
            error={error.dubbed}
            hideDubladoBadge
            hasMore={hasMore.dubbed}
            loadingMore={loadingMore.dubbed}
            onLoadMore={() => loadMoreCategory("dubbed")}
          />

          <DoramaSection
            id="baby"
            title="Bebês e Gravidezes"
            icon={<Baby className="w-6 h-6 text-pink-400" />}
            doramas={doramas.baby}
            loading={loading.baby}
            error={error.baby}
            hasMore={hasMore.baby}
            loadingMore={loadingMore.baby}
            onLoadMore={() => loadMoreCategory("baby")}
          />

          <DoramaSection
            id="taboo"
            title="Relacionamento Tabu"
            icon={<HeartHandshake className="w-6 h-6 text-red-400" />}
            doramas={doramas.taboo}
            loading={loading.taboo}
            error={error.taboo}
            hasMore={hasMore.taboo}
            loadingMore={loadingMore.taboo}
            onLoadMore={() => loadMoreCategory("taboo")}
          />

          <DoramaSection
            id="lobos-vampiros"
            title="Lobos & Vampiros"
            icon={<Moon className="w-6 h-6 text-indigo-400" />}
            doramas={doramas.lobos_vampiros}
            loading={loading.lobos_vampiros}
            error={error.lobos_vampiros}
            hasMore={hasMore.lobos_vampiros}
            loadingMore={loadingMore.lobos_vampiros}
            onLoadMore={() => loadMoreCategory("lobos_vampiros")}
          />

          <DoramaSection
            id="bl-gl"
            title="BL & GL"
            icon={<Heart className="w-6 h-6 text-rose-400" />}
            doramas={doramas.bl_gl}
            loading={loading.bl_gl}
            error={error.bl_gl}
            hasMore={hasMore.bl_gl}
            loadingMore={loadingMore.bl_gl}
            onLoadMore={() => loadMoreCategory("bl_gl")}
          />

          <DoramaSection
            id="brasileiros"
            title="Brasileiros"
            icon={<Flag className="w-6 h-6 text-emerald-400" />}
            doramas={doramas.brasileiro}
            loading={loading.brasileiro}
            error={error.brasileiro}
            hasMore={hasMore.brasileiro}
            loadingMore={loadingMore.brasileiro}
            onLoadMore={() => loadMoreCategory("brasileiro")}
          />

          <DoramaSection
            id="animes"
            title="Animes"
            icon={<Tv className="w-6 h-6 text-cyan-400" />}
            doramas={doramas.anime}
            loading={loading.anime}
            error={error.anime}
            hasMore={hasMore.anime}
            loadingMore={loadingMore.anime}
            onLoadMore={() => loadMoreCategory("anime")}
          />

          <DoramaSection
            id="hidden"
            title="Identidade Escondida"
            icon={<Eye className="w-6 h-6 text-teal-400" />}
            doramas={doramas.hidden}
            loading={loading.hidden}
            error={error.hidden}
            hasMore={hasMore.hidden}
            loadingMore={loadingMore.hidden}
            onLoadMore={() => loadMoreCategory("hidden")}
          />

          <DoramaSection
            id="recomendados"
            title="Recomendados Para Você"
            icon={<Star className="w-6 h-6 text-amber-400" />}
            doramas={doramas.recommended}
            loading={loading.recommended}
            error={error.recommended}
            hasMore={hasMore.recommended}
            loadingMore={loadingMore.recommended}
            onLoadMore={() => loadMoreCategory("recommended")}
          />
        </div>
      </main>

      {/* ✅ 07/08 — TESTE: pro tesagencia, some (já tem o link em Configurações) */}
      {!showBottomNav && (
        <footer className="text-center py-6 border-t border-slate-900 mt-8">
          <a href="/privacidade" className="text-slate-600 hover:text-slate-400 text-xs transition">
            Política de Privacidade
          </a>
        </footer>
      )}
    </>
  );
};

export default Dashboard;
