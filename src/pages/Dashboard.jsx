// src/pages/Dashboard.jsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import { Helmet } from "react-helmet";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";

import Navbar from "@/components/Navbar";
import DoramaCard from "@/components/DoramaCard";
import WelcomeMessage from "@/components/WelcomeMessage";

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
  Megaphone,
  ExternalLink,
} from "lucide-react";

const LIST_LIMIT = 250; // ✅ 150 -> 250 (abas/categorias)
const RECOMMENDED_LIMIT = 400; // ✅ 300 -> 400 (recomendados)

// ✅ Seletores em fallback (pra NUNCA quebrar por coluna inexistente)
const SELECT_LEVELS = [
  // Mais completo (se existir tudo)
  "id,slug,title,original_title,description,created_at,banner_url,cover_url,thumbnail_url,language,is_featured,is_new,is_recommended,is_baby_pregnancy,is_taboo_relationship,is_hidden_identity,bunny_url,bunny_stream_url",
  // Médio (remove campos que costumam não existir em alguns schemas)
  "id,slug,title,description,created_at,banner_url,cover_url,thumbnail_url,language,is_featured,is_new,is_recommended,is_baby_pregnancy,is_taboo_relationship,is_hidden_identity,bunny_url,bunny_stream_url",
  // Mínimo (quase impossível falhar)
  "id,slug,title,description,created_at,cover_url,language,is_featured,is_new,bunny_url,bunny_stream_url",
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
const DoramaSection = ({ title, icon, doramas, loading, error, id }) => {
  const listRef = useRef(null);

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
    <section id={id} className="py-4 md:py-8 relative w-full">
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <h2 className="text-2xl md:text-3xl font-bold text-white">{title}</h2>
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
            className="flex gap-4 overflow-x-auto pb-4 no-scrollbar"
          >
            {doramas.map((d, index) => (
              <div
                key={d.id}
                className="min-w-[150px] sm:min-w-[180px] md:min-w-[200px]"
              >
                <DoramaCard dorama={d} index={index} />
              </div>
            ))}
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

// ---------------- DASHBOARD PRINCIPAL ----------------
const Dashboard = ({ searchQuery, setSearchQuery }) => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // ✅ (ADICIONADO) Pixel ID e chave do "dedupe" de Purchase
  const META_PIXEL_ID = "1424314778637167";
  const PURCHASE_SESSION_KEY = `dp_purchase_tracked_${META_PIXEL_ID}`;

  // ✅ (ADICIONADO) 1 dispositivo por vez (device_id)
  const DEVICE_KEY = "dp_device_id";
  const getStoredDeviceId = () => {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch {
      return null;
    }
  };

  const setStoredDeviceId = (value) => {
    try {
      if (!value) localStorage.removeItem(DEVICE_KEY);
      else localStorage.setItem(DEVICE_KEY, value);
    } catch {}
  };

  const generateDeviceId = () => {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch {}
    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
      .toString(16)
      .slice(2)}`;
  };

  const [doramas, setDoramas] = useState({
    featured: [],
    new: [],
    recommended: [],
    dubbed: [],
    baby: [],
    taboo: [],
    hidden: [],
  });

  const [loading, setLoading] = useState({
    featured: true,
    new: true,
    recommended: true,
    dubbed: true,
    baby: true,
    taboo: true,
    hidden: true,
  });

  const [error, setError] = useState({
    featured: false,
    new: false,
    recommended: false,
    dubbed: false,
    baby: false,
    taboo: false,
    hidden: false,
  });

  const [continueWatching, setContinueWatching] = useState([]);
  const [loadingContinue, setLoadingContinue] = useState(true);

  // ✅ (NOVO) estado da busca REAL no banco
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

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
  const goPlans = () => {
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

  // ✅✅✅ (CORRIGIDO) ENFORCE: 1 dispositivo por vez (SEM LOOP DE LOGOUT)
  useEffect(() => {
    const enforceSingleDevice = async () => {
      try {
        if (typeof window === "undefined") return;
        if (authLoading || !user) return;

        let localDeviceId = getStoredDeviceId();

        // ✅ se não existir device_id local, cria (não desloga!)
        if (!localDeviceId) {
          localDeviceId = generateDeviceId();
          setStoredDeviceId(localDeviceId);
        }

        const { data, error } = await supabase
          .from("user_sessions")
          .select("device_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("[single-device] erro ao validar sessão:", error);
          return; // não derruba em erro pra evitar falso positivo
        }

        // ✅ se não existe device_id ainda no banco, grava o primeiro (primeiro device vira o “dono”)
        if (!data?.device_id) {
          const { error: upErr } = await supabase
            .from("user_sessions")
            .upsert(
              {
                user_id: user.id,
                device_id: localDeviceId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" }
            );

          if (upErr) {
            console.error("[single-device] erro ao salvar device_id:", upErr);
          }
          return;
        }

        // ✅ se o device não bate, derruba (aí sim bloqueia compartilhamento)
        if (data.device_id !== localDeviceId) {
          await supabase.auth.signOut();
          window.location.href = "/login?reason=other_device";
        }
      } catch (e) {
        console.error("[single-device] exception:", e);
      }
    };

    enforceSingleDevice();
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
    setLoading((prev) => ({ ...prev, [category]: false }));
  }, []);

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

    fetchCategory(
      "new",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("is_new", true)
          .order("created_at", { ascending: false }),
      LIST_LIMIT
    );

    fetchCategory(
      "recommended",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("is_recommended", true)
          .order("created_at", { ascending: false }),
      RECOMMENDED_LIMIT
    );

    fetchCategory(
      "dubbed",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("language", "dublado")
          .order("created_at", { ascending: false }),
      LIST_LIMIT
    );

    fetchCategory(
      "baby",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("is_baby_pregnancy", true)
          .order("created_at", { ascending: false }),
      LIST_LIMIT
    );

    fetchCategory(
      "taboo",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("is_taboo_relationship", true)
          .order("created_at", { ascending: false }),
      LIST_LIMIT
    );

    fetchCategory(
      "hidden",
      (selectStr) =>
        supabase
          .from("doramas")
          .select(selectStr)
          .eq("is_hidden_identity", true)
          .order("created_at", { ascending: false }),
      LIST_LIMIT
    );
  }, [authLoading, fetchCategory]);

  // ✅ BUSCA REAL NO BANCO (à prova de vírgula, aspas, parênteses, etc.)
  useEffect(() => {
    const q = (searchQuery || "").trim();
    const normalized = q.toLowerCase();

    if (!normalized) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }

    let isCancelled = false;
    setSearchLoading(true);
    setSearchError(false);

    const timer = setTimeout(async () => {
      try {
        const escapeForPostgrestQuoted = (value) => {
          return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        };

        const pattern = escapeForPostgrestQuoted(`%${q}%`);
        const orClause = `title.ilike.${pattern},description.ilike.${pattern}`;

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
        } else {
          setSearchResults(data || []);
        }
      } catch (e) {
        if (isCancelled) return;
        console.error("[search] exception:", e);
        setSearchError(true);
        setSearchResults([]);
      } finally {
        if (!isCancelled) setSearchLoading(false);
      }
    }, 250);

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

  const normalizedQuery = (searchQuery || "").trim().toLowerCase();

  const communityLink = "https://chat.whatsapp.com/HSG7dv1uz0FD07J5Uz2o0k";

  const goCommunity = () => {
    window.open(communityLink, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Helmet>
        <title>Catálogo - DoramasPlus</title>
      </Helmet>

      <Navbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />

      <main className="container mx-auto px-4 sm:px-6 lg:px-8 pt-[100px] md:pt-[110px]">
        <WelcomeMessage user={user} />

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

        {!normalizedQuery && (
          <HeroSection
            featuredDoramas={doramas.featured}
            loading={loading.featured}
          />
        )}

        {!normalizedQuery && (
          <div className="mb-4 md:mb-6">
            <button
              type="button"
              onClick={goCommunity}
              className="w-full text-left bg-slate-900/60 border border-slate-800 hover:border-emerald-500/40 rounded-lg px-4 py-3 md:px-5 md:py-4 transition"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-emerald-400">
                  <Megaphone className="w-5 h-5" />
                </div>

                <div className="flex-1">
                  <p className="font-semibold text-emerald-200">
                    Entre na Comunidade Oficial do DoramasPlus
                  </p>
                  <p className="text-sm text-slate-300 mt-0.5">
                    Avisos, novidades e atualizações importantes da plataforma.
                    Clique para entrar agora.
                  </p>
                </div>

                <div className="text-slate-400">
                  <ExternalLink className="w-4 h-4" />
                </div>
              </div>
            </button>
          </div>
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
                  <DoramaCard key={dorama.id} dorama={dorama} index={index} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* CONTINUAR ASSISTINDO */}
        {!normalizedQuery && (
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
          />
        )}
      </main>
    </>
  );
};

export default Dashboard;
