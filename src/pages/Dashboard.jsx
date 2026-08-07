// src/pages/Dashboard.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import Fuse from "fuse.js";
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
const HeroSection = ({ featuredDoramas, loading }) => {
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
    if (featuredDoramas.length > 1) {
      const timer = setInterval(handleNext, 7000);
      return () => clearInterval(timer);
    }
  }, [featuredDoramas.length, handleNext]);

  // ✅ ALTERAÇÃO ÚNICA: banner agora manda direto pro /watch (teste grátis funciona)
  const handleWatchClick = (slug) => {
    navigate(`/dorama/${slug}/watch`);
  };

  if (loading) {
    return (
      <div className="relative w-full h-[50vh] md:h-[70vh] bg-slate-900 flex items-center justify-center rounded-lg overflow-hidden">
        <Loader2 className="w-10 h-10 animate-spin text-purple-400" />
      </div>
    );
  }

  if (!featuredDoramas || featuredDoramas.length === 0) return null;

  const current = featuredDoramas[currentIndex];
  if (!current) return null;

  // ✅ fallback seguro pra não "sumir imagem"
  const bannerUrl =
    current.banner_url || current.cover_url || current.thumbnail_url || "";
  const posterUrl =
    current.thumbnail_url || current.cover_url || current.banner_url || "";
  const linkTarget = `/dorama/${current.slug}`;

  return (
    <section className="relative w-full h-[65vh] md:h-[70vh] rounded-lg overflow-hidden home-hero mb-6 md:mb-8">
      {/* MOBILE */}
      <div className="md:hidden relative w-full h-full">
        {bannerUrl ? (
          <img
            src={bannerUrl}
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
                src={bannerUrl}
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

// ---------------- SECTION BLOCK (CARROSSEL COM SETAS) ----------------
const DoramaSection = ({
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

  // ✅ 07/08 — TESTE: cards mais compactos (referência: print do app
  // "Dramio" mandado pelo Leandro) pra caber mais fileira por tela e ficar
  // com a mesma "densidade" entre todas as categorias. Gateado pro
  // tesagencia@gmail.com; resto dos usuários mantém o tamanho de sempre.
  const { user } = useAuth();
  const compact = user?.email === BOTTOM_NAV_TEST_EMAIL;
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

  // Se veio vazio, não mostra seção (melhor que “erro”)
  if (!loading && !error && (!doramas || doramas.length === 0)) return null;

  return (
    <section
      id={id}
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

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] bg-slate-800 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-slate-900 border border-red-500/30 text-red-400 p-6 rounded-lg text-center">
          <ServerCrash className="w-8 h-8 mx-auto mb-3" />
          Erro ao carregar esta seção.
        </div>
      ) : (
        <div className="relative w-full">
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
    </section>
  );
};

// Remove acentos e converte para minúsculas — usado no Fuse e na query de slug
const normalizeText = (str) =>
  (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Converte para slug (igual ao admin) — usado para busca tolerante a acentos no banco
const slugifyQuery = (str) =>
  normalizeText(str).trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "");

// ---------------- DASHBOARD PRINCIPAL ----------------
// ✅ 07/08 — TESTE: pro tesagencia, "Continuar Assistindo" some daqui porque
// virou a aba "Histórico" da barra inferior (BottomNav.jsx). Resto dos
// usuários mantém a seção como sempre foi.
const BOTTOM_NAV_TEST_EMAIL = "tesagencia@gmail.com";

const Dashboard = ({ searchQuery, setSearchQuery }) => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation(); // ✅ (ADICIONADO) para capturar ?src=
  const showBottomNav = user?.email === BOTTOM_NAV_TEST_EMAIL;

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

  const [doramas, setDoramas] = useState({
    featured: [],
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

  // Índice de todos os doramas (1791 rows) — usado pelo Fuse quando o banco
  // não retorna nada (typos). Carregado SOB DEMANDA na primeira busca pra
  // não pesar o first paint da home (era ~2MB de JSON no mount).
  const doramaIndexRef = useRef([]);
  const doramaIndexLoadingRef = useRef(false);
  const ensureDoramaIndex = useCallback(async () => {
    if (doramaIndexRef.current.length > 0) return;
    if (doramaIndexLoadingRef.current) return;
    doramaIndexLoadingRef.current = true;
    try {
      const { data } = await supabase
        .from("doramas")
        .select("id,slug,title,description,created_at,cover_url,language,is_featured,is_new")
        .order("title");
      if (data) doramaIndexRef.current = data;
    } finally {
      doramaIndexLoadingRef.current = false;
    }
  }, []);

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

    setDoramas((prev) => ({ ...prev, [category]: data || [] }));
    if (CATEGORY_QUERIES[category]) {
      setHasMore((prev) => ({ ...prev, [category]: (data || []).length === limit }));
    }
    setLoading((prev) => ({ ...prev, [category]: false }));
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
  useEffect(() => {
    if (authLoading) return;

    fetchCategory(
      "featured",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("is_featured", true)
          .order("created_at", { ascending: false }),
      10
    );

    Object.entries(CATEGORY_QUERIES).forEach(([key, cfg]) => {
      fetchCategory(key, cfg.build, cfg.limit);
    });
  }, [authLoading, fetchCategory]);

  // ✅ BUSCA: ILIKE + slug (acentos) + Fuse.js (typos)
  useEffect(() => {
    const q = (searchQuery || "").trim();

    if (!q) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }

    let isCancelled = false;
    setSearchLoading(true);
    setSearchError(false);

    const fuseOptions = {
      keys: [
        { name: "title", weight: 0.8 },
        { name: "description", weight: 0.2 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 2,
      getFn: (obj, path) => {
        const key = Array.isArray(path) ? path[0] : path;
        return normalizeText(obj[key] || "");
      },
    };

    const timer = setTimeout(async () => {
      try {
        const escapeForPostgrestQuoted = (value) => {
          return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        };

        const slugQ = slugifyQuery(q);
        const pattern = escapeForPostgrestQuoted(`%${q}%`);
        const slugPattern = escapeForPostgrestQuoted(`%${slugQ}%`);
        const orClause = `title.ilike.${pattern},description.ilike.${pattern},slug.ilike.${slugPattern}`;

        const { data, error: err } = await runQueryWithFallback((selectStr) =>
          supabase
            .from("doramas")
            .select(selectStr)
            .or(orClause)
            .order("created_at", { ascending: false })
            .limit(80)
        );

        if (isCancelled) return;

        if (err) {
          console.error("[search] erro:", err);
          setSearchError(true);
          setSearchResults([]);
          return;
        }

        const dbResults = data || [];

        if (dbResults.length > 0) {
          // Banco encontrou algo — reordena por relevância fuzzy
          const fuse = new Fuse(dbResults, fuseOptions);
          const hits = fuse.search(normalizeText(q));
          setSearchResults(hits.length > 0 ? hits.map((r) => r.item) : dbResults);
        } else {
          // Banco não encontrou nada — Fuse no índice completo (typos).
          // Carrega o índice na demanda (1ª busca paga o custo, demais reusam).
          await ensureDoramaIndex();
          if (isCancelled) return;
          const index = doramaIndexRef.current;
          if (index.length > 0) {
            const fuse = new Fuse(index, { ...fuseOptions, threshold: 0.35 });
            const hits = fuse.search(normalizeText(q));
            setSearchResults(hits.map((r) => r.item));
          } else {
            setSearchResults([]);
          }
        }
      } catch (e) {
        if (isCancelled) return;
        console.error("[search] exception:", e);
        setSearchError(true);
        setSearchResults([]);
      } finally {
        if (!isCancelled) setSearchLoading(false);
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, ensureDoramaIndex]);

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

  const normalizedQuery = (searchQuery || "").trim().toLowerCase();

  const communityLink = "https://chat.whatsapp.com/Kp6dQuElfhrHWeuv1qUwtR";

  const goCommunity = () => {
    window.open(communityLink, "_blank", "noopener,noreferrer");
  };

  // ✅ 27/07: no Android, troca o slide da Dora por "baixar o app oficial"
  // (Play Store, agora com o assetlinks.json corrigido) — no iPhone não tem
  // Play Store, então mantém a Dora normal ali. O rodapé (InstallAppBanner)
  // não muda pro iOS, continua só a instrução de tela de início.
  const isAndroidDevice =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const PLAY_STORE_URL =
    "https://play.google.com/store/apps/details?id=br.com.doramasplus.twa";

  // Carrossel de banners no topo da home (alterna a cada 5s)
  // ✅ 27/07: slide do app (Android) / Dora (iPhone) vem primeiro agora —
  // era o último, pedido pra dar mais destaque pro app.
  const homeBanners = [
    isAndroidDevice
      ? {
          icon: Smartphone,
          title: "📲 Baixe o app oficial no Play Store",
          subtitle: "Mais rápido e direto na tela inicial, sem passar pelo navegador",
          gradient: "from-blue-600 via-indigo-600 to-purple-600",
          glow: "from-blue-600 via-indigo-500 to-purple-600",
          onClick: () =>
            window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer"),
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
  ];

  const [bannerIndex, setBannerIndex] = useState(0);

  useEffect(() => {
    if (normalizedQuery) return; // banner some durante a busca
    const id = setInterval(() => {
      setBannerIndex((i) => (i + 1) % homeBanners.length);
    }, 10000);
    return () => clearInterval(id);
  }, [normalizedQuery]);

  return (
    <>
      <Helmet>
        <title>Catálogo - DoramasPlus</title>
      </Helmet>

      <Navbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />

      <SelectedTesterModal />

      <main
        className={`container mx-auto px-4 sm:px-6 lg:px-8 pt-[100px] md:pt-[110px] ${
          showBottomNav ? "pb-20" : ""
        }`}
      >
        {/* ✅ (NOVO) BOTÃO "ASSINE AGORA" — só pra logado que NUNCA foi assinante */}
        {!normalizedQuery && user && neverSubscribed && !checkingEverSubscribed && (
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

        {/* ✅ NOVO: barra de busca para NÃO logado (não duplica para logado) */}
        {!user && (
          <div className="mb-4 md:mb-6">
            <div className="w-full rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
              <p className="text-sm font-semibold text-slate-200 mb-2">
                Pesquise um dorama no catálogo
              </p>

              <div className="flex items-center gap-2">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Digite o nome do dorama…"
                  className="w-full h-11 rounded-lg bg-slate-950/60 border border-slate-800 px-3 text-slate-100 placeholder:text-slate-500 outline-none focus:border-purple-500/60"
                />

                {searchQuery?.trim() && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 bg-slate-950/60 border-slate-800 hover:bg-slate-900 text-slate-200"
                    onClick={() => setSearchQuery("")}
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
        )}

        {/* ✅ Carrossel de banners — logo abaixo da busca, acima do banner principal */}
        {!normalizedQuery && (
          <div className="mb-4 md:mb-6">
            <div className="group relative w-full rounded-xl">
              {/* brilho pulsante atrás do banner — muda de cor com o slide atual */}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -inset-0.5 rounded-xl bg-gradient-to-r ${homeBanners[bannerIndex].glow || "from-purple-600 via-fuchsia-500 to-pink-500"} opacity-70 blur-lg animate-pulse transition-colors duration-500`}
              />

              {/* conteúdo (alterna entre os banners) */}
              <div className="relative h-[84px] md:h-[96px] overflow-hidden rounded-xl">
                <AnimatePresence mode="wait">
                  {(() => {
                    const banner = homeBanners[bannerIndex];
                    const Icon = banner.icon;
                    return (
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
                    );
                  })()}
                </AnimatePresence>
              </div>

            </div>
          </div>
        )}

        {!normalizedQuery && (
          <HeroSection
            featuredDoramas={doramas.featured}
            loading={loading.featured}
          />
        )}

        {/* ✅ BUSCA (agora é do BANCO, não das categorias) */}
        {normalizedQuery && (
          <section className="py-4 md:py-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl md:text-2xl font-bold text-white">
                Resultados para:{" "}
                <span className="text-purple-400">"{searchQuery}"</span>
              </h2>

              <span className="text-sm text-slate-400">
                {searchLoading
                  ? "Buscando..."
                  : `${searchResults.length} encontrado${
                      searchResults.length === 1 ? "" : "s"
                    }`}
              </span>
            </div>

            {searchLoading ? (
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {searchResults.map((dorama, index) => (
                  <DoramaCard key={dorama.id} dorama={dorama} index={index} hideYear />
                ))}
              </div>
            )}
          </section>
        )}

        {/* CONTINUAR ASSISTINDO — pro tesagencia isso virou a aba Histórico */}
        {!normalizedQuery && !showBottomNav && (
          <section className="py-4 md:py-6 relative w-full">
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

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}

        {!normalizedQuery && (
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
        )}
      </main>

      <footer className="text-center py-6 border-t border-slate-900 mt-8">
        <a href="/privacidade" className="text-slate-600 hover:text-slate-400 text-xs transition">
          Política de Privacidade
        </a>
      </footer>
    </>
  );
};

export default Dashboard;
