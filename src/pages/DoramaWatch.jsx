import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Helmet } from "react-helmet";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Crown, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/SupabaseAuthContext";
import Hls from "hls.js";
import useSessionGuard from "@/hooks/useSessionGuard";

// ✅ TESTE — só ativa session guard pra este email
// Para ativar pra TODOS: mude para null
const SINGLE_SESSION_TEST_EMAIL = null;

export default function DoramaWatch() {
  const { id: slugFromUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const { user, isAuthenticated, isPremium, checkingPremium, loading } = useAuth();

  // ✅ Trava de sessão única — só ativa para o email de teste
  // Quando SINGLE_SESSION_TEST_EMAIL = null, protege todos os usuários
  const shouldGuard = !SINGLE_SESSION_TEST_EMAIL ||
    user?.email === SINGLE_SESSION_TEST_EMAIL;
  useSessionGuard(shouldGuard);

  const [dorama, setDorama] = useState(null);
  const [loadingDorama, setLoadingDorama] = useState(true);
  const [error, setError] = useState(false);

  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  // ✅ Tempo salvo vs tempo atual (não deixar virar "espelho" do tempo)
  const [savedSeconds, setSavedSeconds] = useState(0); // vem do banco
  const [liveSeconds, setLiveSeconds] = useState(0); // apenas informativo

  // ✅ Anti-regressão (não deixar 40min virar 10s)
  const hasAppliedResumeRef = useRef(false);
  const lastSavedRef = useRef(0);
  const latestTimeRef = useRef(0);
  const latestDurationRef = useRef(0);

  const WATCH_TABLE = "watch_history";
  const EPISODE_DEFAULT = 1;

  // ✅ TESTE GRÁTIS via IP (edge function)
  const FREE_TRIAL_URL = "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/free-trial";

  const [ipTrialAllowed, setIpTrialAllowed] = useState(false);
  const [ipTrialExpired, setIpTrialExpired] = useState(false);
  const [ipTrialRemaining, setIpTrialRemaining] = useState(0);
  const [ipTrialChecked, setIpTrialChecked] = useState(false);

  const nextUrl = useMemo(() => {
    return location.pathname + location.search;
  }, [location.pathname, location.search]);

  // ✅ Modo iPhone via querystring (?mode=iphone)
  const isIphoneMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get("mode") || "").toLowerCase() === "iphone";
  }, [location.search]);

  // ✅ Detecta iPhone/iPad (ainda útil pra copy, mas agora modo iPhone é liberado pra Android também)
  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const iOS = /iPhone|iPad|iPod/i.test(ua);
    const iPadOS13 = /Macintosh/i.test(ua) && "ontouchend" in document;
    return iOS || iPadOS13;
  }, []);

  // captura ?src= e salva no localStorage (mesmo padrão de ComoFunciona.jsx)
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

  useEffect(() => {
    const fetchDorama = async () => {
      setLoadingDorama(true);
      setError(false);

      try {
        if (!slugFromUrl) {
          setError(true);
          return;
        }

        const normalizedSlug = decodeURIComponent(slugFromUrl).trim().toLowerCase();

        const { data, error: queryError } = await supabase
          .from("doramas")
          .select("*")
          .eq("slug", normalizedSlug)
          .single();

        if (queryError || !data) {
          console.error("Erro Supabase:", queryError);
          setError(true);
          return;
        }

        setDorama(data);
      } catch (err) {
        console.error("Erro inesperado:", err);
        setError(true);
      } finally {
        setLoadingDorama(false);
      }
    };

    fetchDorama();
  }, [slugFromUrl]);

  // ✅ Escolhe URL (normal vs iphone)
  const videoUrl = useMemo(() => {
    if (!dorama) return "";

    const embed = (dorama.bunny_embed_url || "").trim();

    const normal = (dorama.bunny_url || dorama.bunny_stream_url || embed || "").trim();
    const iphone = (dorama.bunny_stream_url || dorama.bunny_url || embed || "").trim();

    return isIphoneMode ? iphone : normal;
  }, [dorama, isIphoneMode]);

  const hasStream = !!(dorama?.bunny_stream_url && String(dorama.bunny_stream_url).trim());

  // ✅ tipo do player
  const playerType = useMemo(() => {
    const url = (videoUrl || "").toLowerCase();
    if (!url) return "none";

    if (url.includes(".m3u8")) return "hls";
    if (url.includes(".mp4")) return "mp4";

    if (url.includes("iframe.mediadelivery.net")) return "iframe";
    if (url.includes("/embed/")) return "iframe";

    if (url.startsWith("http")) return "video";

    return "none";
  }, [videoUrl]);

  // ✅ autoplay no iframe (apenas visual)
  const iframeSrc = useMemo(() => {
    if (playerType !== "iframe") return "";
    const base = (videoUrl || "").trim();
    if (!base) return "";

    try {
      const u = new URL(base, window.location.origin);
      if (!u.searchParams.has("autoplay")) u.searchParams.set("autoplay", "true");
      u.searchParams.set("_ts", String(Date.now()));
      return u.toString();
    } catch {
      const join = base.includes("?") ? "&" : "?";
      return `${base}${join}autoplay=true&_ts=${Date.now()}`;
    }
  }, [videoUrl, playerType]);

  // ✅ HLS (somente quando playerType === "hls")
  useEffect(() => {
    const el = videoRef.current;

    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }

    if (!el) return;
    if (!videoUrl) return;
    if (playerType !== "hls") return;

    const canPlayNative = el.canPlayType("application/vnd.apple.mpegurl");
    if (canPlayNative) {
      el.src = videoUrl;
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: false,
        backBufferLength: 90,
      });
      hlsRef.current = hls;
      hls.loadSource(videoUrl);
      hls.attachMedia(el);
    } else {
      el.src = videoUrl;
    }
  }, [videoUrl, playerType]);

  const goIphoneMode = () => {
    navigate(`/dorama/${dorama?.slug || slugFromUrl}/watch?mode=iphone`, { replace: true });
  };

  const goDefaultMode = () => {
    navigate(`/dorama/${dorama?.slug || slugFromUrl}/watch`, { replace: true });
  };

  // ✅ REGRA: continuar assistindo SOMENTE no modo normal + <video> (Storage).
  const allowContinue = useMemo(() => {
    if (!isPremium) return false;
    if (!user?.id) return false;
    if (!dorama?.id) return false;
    if (isIphoneMode) return false;
    return playerType === "mp4" || playerType === "hls" || playerType === "video";
  }, [isPremium, user?.id, dorama?.id, isIphoneMode, playerType]);

  // ✅ TESTE GRÁTIS: controle por IP via edge function (só para NÃO logado)
  useEffect(() => {
    if (loading) return;

    if (isAuthenticated) {
      setIpTrialChecked(true);
      return;
    }

    let countdownId;
    let pingId;
    let active = true;

    const callApi = async (action) => {
      try {
        const res = await fetch(FREE_TRIAL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        return await res.json();
      } catch {
        return null;
      }
    };

    const handleExpired = () => {
      if (!active) return;
      clearInterval(countdownId);
      clearInterval(pingId);
      setIpTrialExpired(true);
      setIpTrialAllowed(false);
      setIpTrialRemaining(0);
      try {
        const el = videoRef.current;
        if (el && typeof el.pause === "function") el.pause();
      } catch {}
    };

    (async () => {
      const data = await callApi("start");
      if (!active) return;
      setIpTrialChecked(true);

      if (!data || !data.allowed || data.status === "expired") {
        setIpTrialExpired(true);
        setIpTrialAllowed(false);
        return;
      }

      let remaining = data.remaining_seconds ?? 600;
      setIpTrialAllowed(true);
      setIpTrialRemaining(remaining);

      countdownId = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          handleExpired();
        } else {
          setIpTrialRemaining(remaining);
        }
      }, 1000);

      pingId = setInterval(async () => {
        const pingData = await callApi("ping");
        if (!active) return;
        if (!pingData || !pingData.allowed) {
          handleExpired();
        } else if (pingData.remaining_seconds != null) {
          remaining = pingData.remaining_seconds;
          setIpTrialRemaining(pingData.remaining_seconds);
        }
      }, 30_000);
    })();

    return () => {
      active = false;
      clearInterval(countdownId);
      clearInterval(pingId);
    };
  }, [loading, isAuthenticated]);

  // ✅ Carrega tempo salvo do banco
  useEffect(() => {
    if (!allowContinue) {
      setSavedSeconds(0);
      setLiveSeconds(0);
      lastSavedRef.current = 0;
      hasAppliedResumeRef.current = false;
      return;
    }

    (async () => {
      try {
        const { data, error: e } = await supabase
          .from(WATCH_TABLE)
          .select("current_time")
          .eq("user_id", user.id)
          .eq("dorama_id", dorama.id)
          .eq("episode", EPISODE_DEFAULT)
          .maybeSingle();

        if (e) console.error("watch_history select error:", e);

        const t = data?.current_time;
        const saved = typeof t === "number" ? Math.floor(t) : 0;

        setSavedSeconds(saved);
        setLiveSeconds(0);

        lastSavedRef.current = saved;
        hasAppliedResumeRef.current = false;
      } catch (err) {
        console.error("watch_history select fatal:", err);
        setSavedSeconds(0);
        setLiveSeconds(0);
        lastSavedRef.current = 0;
        hasAppliedResumeRef.current = false;
      }
    })();
  }, [allowContinue, user?.id, dorama?.id]);

  // ✅ salvar progresso com trava pra nunca voltar pra trás
  const saveProgress = async (seconds, durationMaybe) => {
    if (!allowContinue) return;

    const s = Math.floor(seconds || 0);
    if (s <= 0) return;

    const prev = Math.floor(lastSavedRef.current || 0);

    if (prev >= 30 && s < prev - 5) return;
    if (prev >= 30 && !hasAppliedResumeRef.current && s < 30) return;

    const dur = Math.floor(durationMaybe || 0);

    const { error: upsertError } = await supabase.from(WATCH_TABLE).upsert(
      {
        user_id: user.id,
        dorama_id: dorama.id,
        episode: EPISODE_DEFAULT,
        current_time: s,
        duration: dur > 0 ? dur : null,
        finished: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,dorama_id,episode" }
    );

    if (upsertError) {
      console.error("watch_history upsert error:", upsertError);
      return;
    }

    lastSavedRef.current = s;
    if (s > savedSeconds) setSavedSeconds(s);
  };

  // ✅ TRACKING DO <VIDEO> + AUTO-RESUME + FLUSH
  useEffect(() => {
    const el = videoRef.current;
    if (!allowContinue) return;
    if (!el) return;

    let lastSaveAt = 0;

    const capture = () => {
      latestTimeRef.current = el.currentTime || 0;
      latestDurationRef.current = el.duration || 0;
    };

    const applyResume = async () => {
      if (hasAppliedResumeRef.current) return;
      if (!savedSeconds || savedSeconds < 10) return;
      if (el.readyState < 1) return;

      try {
        el.currentTime = savedSeconds;
        hasAppliedResumeRef.current = true;
        try {
          await el.play();
        } catch {}
      } catch {}
    };

    const flush = () => {
      capture();
      const t = latestTimeRef.current;
      if (t > 0) saveProgress(t, latestDurationRef.current);
    };

    const onLoadedMetadata = () => {
      applyResume();
    };

    const onTime = () => {
      capture();
      setLiveSeconds(Math.floor(latestTimeRef.current));

      const now = Date.now();
      if (now - lastSaveAt < 5_000) return;
      lastSaveAt = now;

      saveProgress(latestTimeRef.current, latestDurationRef.current);
    };

    const onPause = () => flush();
    const onEnded = () => flush();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    const onBeforeUnload = () => flush();

    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    setTimeout(() => applyResume(), 150);

    setTimeout(async () => {
      try {
        await el.play();
      } catch {}
    }, 200);

    return () => {
      flush();
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowContinue, videoUrl, dorama?.id, user?.id, savedSeconds]);

  const canResume = allowContinue && savedSeconds >= 10;

  const handleResume = async () => {
    if (!canResume) return;
    const el = videoRef.current;
    if (!el) return;

    try {
      el.currentTime = savedSeconds;
      hasAppliedResumeRef.current = true;
      await el.play?.();
    } catch {}
  };

  // ✅ GATE: logado sem premium -> plans
  if (!loading && isAuthenticated && !checkingPremium && !isPremium) {
    return (
      <Navigate
        to={`/plans?next=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }

  // ✅ (CORREÇÃO DO BUG): só espera checkingPremium se estiver logado
  if (loading || loadingDorama || (isAuthenticated && checkingPremium) || (!isAuthenticated && !ipTrialChecked)) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center text-white">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400 mr-2" />
        <div className="animate-pulse">Carregando...</div>
      </div>
    );
  }

  if (error || !dorama) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white gap-4 p-4">
        <h2 className="text-xl font-semibold text-red-400">Vídeo não encontrado</h2>
        <p className="text-slate-400 text-center max-w-md">
          Não foi possível carregar o vídeo para "{slugFromUrl}".
        </p>
        <Button
          onClick={() => navigate("/dashboard")}
          variant="outline"
          className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-200"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar para o Catálogo
        </Button>
      </div>
    );
  }

  const formatTrialTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <>
      <Helmet>
        <title>{dorama.title ? `Assistindo: ${dorama.title}` : "Assistir Dorama"}</title>
        <meta name="description" content={`Assista ao dorama ${dorama.title} online.`} />
      </Helmet>

      <div className="min-h-screen bg-black flex flex-col text-slate-100">
        {/* Topo */}
        <header className="p-4 flex items-center justify-start z-10 shrink-0">
          <Button
            onClick={() => navigate(`/dorama/${dorama.slug}`)}
            variant="ghost"
            className="text-slate-300 hover:text-white hover:bg-white/10"
          >
            <ArrowLeft className="w-5 h-5 mr-2" /> Voltar
          </Button>
        </header>

        {/* Player */}
        <main className="flex-1 flex flex-col items-center justify-start w-full bg-black">
          <div className="w-full max-w-[1400px] mx-auto px-0 sm:px-4">
            {/* ✅ TESTE GRÁTIS: aviso (só quando ativo) */}
            {!isAuthenticated && ipTrialAllowed && !ipTrialExpired && (
              <div className="px-3 sm:px-0 mb-3">
                <div className="w-full rounded-lg border border-emerald-500/20 bg-emerald-900/10 px-4 py-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-emerald-200">🎁 Teste grátis em andamento</span>
                    <span className="text-slate-300/90">Crie sua conta para continuar depois</span>
                  </div>
                </div>
              </div>
            )}

            {/* ✅ AVISO MODO IPHONE */}
            {hasStream && !isIphoneMode && (
              <div className="px-3 sm:px-0 mb-3">
                <div className="w-full rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-200">
                  <button
                    type="button"
                    onClick={goIphoneMode}
                    className="font-semibold text-purple-300 underline underline-offset-4 hover:text-purple-200"
                  >
                    Se o vídeo não abrir, clique aqui
                  </button>
                  .{" "}
                  <span className="text-slate-300/90">
                    Ao abrir por este link, a opção "Continuar de onde parou" não estará disponível.
                  </span>
                </div>
              </div>
            )}

            {isIphoneMode && (
              <div className="px-3 sm:px-0 mb-3">
                <div className="w-full rounded-lg border border-purple-500/20 bg-purple-900/15 px-4 py-3 text-sm text-slate-200">
                  Modo iPhone ativado.{" "}
                  <button
                    type="button"
                    onClick={goDefaultMode}
                    className="font-semibold text-purple-300 underline underline-offset-4 hover:text-purple-200"
                  >
                    voltar ao modo normal
                  </button>
                  .{" "}
                  <span className="text-slate-300/90">
                    No Modo iPhone, o "Continuar assistindo" fica desativado.
                  </span>
                </div>
              </div>
            )}

            {/* ✅ CONTINUAR DE ONDE PAROU */}
            {canResume && (
              <div className="px-3 sm:px-0 mb-3">
                <button
                  type="button"
                  onClick={handleResume}
                  className="w-full rounded-lg border border-emerald-500/20 bg-emerald-900/10 px-4 py-3 text-left"
                >
                  <div className="text-emerald-200 font-semibold">
                    Continuar assistindo de onde parou
                  </div>
                  <div className="text-emerald-200/70 text-sm">
                    Retomar a partir de ~ {Math.floor(savedSeconds / 60)} min
                  </div>
                </button>
              </div>
            )}

            {/* ✅ PLAYER GRANDÃO */}
            <div className="relative w-full h-[70vh] md:h-[80vh] bg-black overflow-hidden rounded-none sm:rounded-lg border border-slate-800">
              {!isPremium && isAuthenticated ? (
                <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-slate-300 p-6 text-center">
                  <Crown className="w-16 h-16 text-yellow-400 mb-4" />
                  <h2 className="text-2xl font-bold text-white mb-2">Assinatura necessária</h2>
                  <p className="max-w-md mb-6 text-slate-400">
                    Você precisa ser assinante DoramasPlus para assistir a este conteúdo.
                  </p>
                  <Button
                    onClick={() => navigate("/plans")}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold"
                    size="lg"
                  >
                    Assinar agora
                  </Button>
                </div>
              ) : !isAuthenticated && (!ipTrialAllowed || ipTrialExpired) ? (
                <div className="w-full h-full bg-black" />
              ) : !videoUrl ? (
                <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center text-slate-500">
                  <p>Vídeo indisponível no momento.</p>
                </div>
              ) : playerType === "iframe" ? (
                <iframe
                  src={iframeSrc || videoUrl}
                  title={dorama.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  loading="lazy"
                  className="absolute inset-0 w-full h-full border-0 block"
                />
              ) : (
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  autoPlay
                  className="absolute inset-0 w-full h-full"
                  src={playerType === "mp4" || playerType === "video" ? videoUrl : undefined}
                />
              )}

              {/* ✅ CONTADOR REGRESSIVO: canto superior direito */}
              {!isAuthenticated && ipTrialAllowed && !ipTrialExpired && (
                <div className="absolute top-3 right-3 z-10 bg-black/60 text-emerald-300 text-xs font-mono px-2 py-1 rounded-full pointer-events-none select-none">
                  Teste grátis: {formatTrialTime(ipTrialRemaining)}
                </div>
              )}

              {/* ✅ OVERLAY: teste expirado */}
              {!isAuthenticated && ipTrialExpired && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 px-6 text-center">
                  <p className="text-white text-lg font-semibold mb-2">
                    Seu teste gratuito de 10 minutos acabou.
                  </p>
                  <p className="text-slate-300 text-sm mb-6">
                    Crie uma conta para continuar assistindo!
                  </p>
                  <Button
                    onClick={() => navigate(`/signup?next=${encodeURIComponent(location.pathname + location.search)}`)}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold"
                    size="lg"
                  >
                    Criar conta grátis
                  </Button>
                </div>
              )}
            </div>
          </div>

          {isPremium && (
            <p className="mt-4 text-center text-sm md:text-base font-medium text-purple-400 px-4 pb-6">
              Dica: toque no vídeo e depois toque no ícone de tela cheia (quadradinho ao lado do som).
            </p>
          )}
        </main>
      </div>
    </>
  );
}
