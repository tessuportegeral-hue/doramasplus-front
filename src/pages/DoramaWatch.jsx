import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Helmet } from "react-helmet";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Crown, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/SupabaseAuthContext";
import { useToast } from "@/components/ui/use-toast";
import Hls from "hls.js";
import useSessionGuard from "@/hooks/useSessionGuard";
import { usePlaybackGuard } from "@/hooks/usePlaybackGuard";
import PlaybackLimitModal from "@/components/PlaybackLimitModal";

// Feature flag: controle de telas simultâneas
const PLAYBACK_ENABLED = import.meta.env.VITE_ENABLE_PLAYBACK_LIMIT === "true";

export default function DoramaWatch() {
  const { id: slugFromUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const { user, isAuthenticated, isPremium, checkingPremium, loading } = useAuth();
  const { toast } = useToast();

  useSessionGuard();

  // ── Novo sistema de telas simultâneas ──
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitInfo, setLimitInfo] = useState(null);
  const [playerVisible, setPlayerVisible] = useState(true);
  const hasClaimedRef = useRef(false);

  const guardActive = PLAYBACK_ENABLED;

  const onKick = useCallback(() => {
    setPlayerVisible(false);
    toast({
      title: "Sessão encerrada",
      description: "Outro dispositivo assumiu a reprodução.",
      variant: "destructive",
    });
    window.location.href = "/login";
  }, [toast]);

  const onLimitReached = useCallback((info) => {
    setLimitInfo(info);
    setShowLimitModal(true);
  }, []);

  const { claim, claiming, claimed } = usePlaybackGuard({
    shouldGuard: isAuthenticated && !!user,
    onKick,
    onLimitReached,
  });

  // Auto-claim quando player está pronto
  useEffect(() => {
    if (!isAuthenticated || !user || hasClaimedRef.current) return;
    hasClaimedRef.current = true;
    claim();
  }, [isAuthenticated, user, claim]);

  const [dorama, setDorama] = useState(null);
  const [loadingDorama, setLoadingDorama] = useState(true);
  const [error, setError] = useState(false);

  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const hlsRef = useRef(null);
  const playerJsRef = useRef(null);

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

  // ✅ TESTE GRÁTIS (NOVO): 20 minutos GLOBAL para quem NÃO está logado
  const TRIAL_SECONDS = 20 * 60; // 20 min
  const TRIAL_START_KEY = "dp_trial_started_at_ms";
  const TRIAL_LOCK_KEY = "dp_trial_locked";

  const [trialRemaining, setTrialRemaining] = useState(TRIAL_SECONDS);
  const [trialExpired, setTrialExpired] = useState(false);

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

  const videoUrl = useMemo(() => {
    if (!dorama) return "";
    const embed = (dorama.bunny_embed_url || "").trim();
    return (dorama.bunny_stream_url || dorama.bunny_url || embed).trim();
  }, [dorama]);

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

  const allowContinue = useMemo(() => {
    if (!isPremium) return false;
    if (!user?.id) return false;
    if (!dorama?.id) return false;
    return playerType === "mp4" || playerType === "hls" || playerType === "video" || playerType === "iframe";
  }, [isPremium, user?.id, dorama?.id, playerType]);

  // ✅ TESTE GRÁTIS: relógio GLOBAL usando localStorage (só para NÃO logado)
  useEffect(() => {
    if (loading) return;

    if (isAuthenticated) {
      setTrialExpired(false);
      setTrialRemaining(TRIAL_SECONDS);
      return;
    }

    try {
      const locked = localStorage.getItem(TRIAL_LOCK_KEY) === "1";
      if (locked) {
        setTrialExpired(true);
        setTrialRemaining(0);
        return;
      }

      let startMs = Number(localStorage.getItem(TRIAL_START_KEY) || "0");
      if (!startMs || Number.isNaN(startMs)) {
        startMs = Date.now();
        localStorage.setItem(TRIAL_START_KEY, String(startMs));
      }

      const tick = () => {
        const elapsed = Math.floor((Date.now() - startMs) / 1000);
        const remain = Math.max(0, TRIAL_SECONDS - elapsed);
        setTrialRemaining(remain);

        if (remain <= 0) {
          localStorage.setItem(TRIAL_LOCK_KEY, "1");
          setTrialExpired(true);

          try {
            const el = videoRef.current;
            if (el && typeof el.pause === "function") el.pause();
          } catch {}
        }
      };

      tick();
      const iv = setInterval(tick, 1000);
      return () => clearInterval(iv);
    } catch {
      setTrialRemaining(TRIAL_SECONDS);
      setTrialExpired(false);
    }
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

  // ✅ TRACKING DO IFRAME (Bunny Stream via Player.js)
  useEffect(() => {
    if (!allowContinue || playerType !== "iframe") return;
    const el = iframeRef.current;
    if (!el) return;

    let cancelled = false;

    const setup = () => {
      if (cancelled || !window.playerjs) return;
      const player = new window.playerjs.Player(el);
      playerJsRef.current = player;

      player.on("ready", () => {
        if (cancelled || hasAppliedResumeRef.current) return;
        const s = lastSavedRef.current;
        if (s >= 10) {
          player.setCurrentTime(s);
          hasAppliedResumeRef.current = true;
        }
      });

      let lastSaveAt = 0;
      player.on("timeupdate", (data) => {
        if (cancelled) return;
        const s = data?.seconds ?? 0;
        const dur = data?.duration ?? 0;
        latestTimeRef.current = s;
        latestDurationRef.current = dur;
        setLiveSeconds(Math.floor(s));
        const now = Date.now();
        if (now - lastSaveAt < 5_000) return;
        lastSaveAt = now;
        saveProgress(s, dur);
      });
    };

    if (window.playerjs) {
      setup();
    } else {
      const script = document.createElement("script");
      script.src = "//assets.mediadelivery.net/playerjs/player-0.1.0.min.js";
      script.onload = () => { if (!cancelled) setup(); };
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      playerJsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowContinue, playerType, videoUrl]);

  // ✅ AUTO-RESUME iframe após savedSeconds carregado do banco
  useEffect(() => {
    if (!allowContinue || playerType !== "iframe") return;
    if (!playerJsRef.current || hasAppliedResumeRef.current) return;
    if (savedSeconds < 10) return;
    hasAppliedResumeRef.current = true;
    playerJsRef.current.setCurrentTime(savedSeconds);
  }, [allowContinue, playerType, savedSeconds]);

  const canResume = allowContinue && savedSeconds >= 10;

  const handleResume = async () => {
    if (!canResume) return;
    if (playerType === "iframe") {
      if (playerJsRef.current) {
        playerJsRef.current.setCurrentTime(savedSeconds);
        hasAppliedResumeRef.current = true;
      }
      return;
    }
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

  // ✅ teste grátis acabou -> signup
  if (!loading && !isAuthenticated && trialExpired) {
    const _srcParam = new URLSearchParams(location.search).get("src") || "";
    const _srcSuffix = _srcParam ? `&src=${encodeURIComponent(_srcParam)}` : "";
    return (
      <Navigate
        to={`/signup?next=${encodeURIComponent(location.pathname + location.search)}${_srcSuffix}`}
        replace
      />
    );
  }

  // ✅ (CORREÇÃO DO BUG): só espera checkingPremium se estiver logado
  if (loading || loadingDorama || (isAuthenticated && checkingPremium)) {
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

  // ✅ barra do teste grátis (0..1). Quanto menor, mais perto do fim.
  const trialProgress = Math.max(0, Math.min(1, trialRemaining / TRIAL_SECONDS));

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
            {/* ✅ TESTE GRÁTIS: BARRINHA (sem tempo) */}
            {!isAuthenticated && !trialExpired && (
              <div className="px-3 sm:px-0 mb-3">
                <div className="w-full rounded-lg border border-emerald-500/20 bg-emerald-900/10 px-4 py-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-emerald-200">🎁 Teste grátis em andamento</span>
                    <span className="text-slate-300/90">Crie sua conta para continuar depois</span>
                  </div>

                  <div className="mt-2 w-full h-2 bg-slate-800/70 rounded-full overflow-hidden">
                    <div
                      className="h-2 bg-emerald-400"
                      style={{ width: `${Math.round(trialProgress * 100)}%` }}
                    />
                  </div>
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
              ) : !videoUrl || !playerVisible ? (
                <div className="w-full h-full bg-black" />
              ) : playerType === "iframe" ? (
                <iframe
                  ref={iframeRef}
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
            </div>
          </div>

          {isPremium && (
            <p className="mt-4 text-center text-sm md:text-base font-medium text-purple-400 px-4 pb-6">
              Dica: toque no vídeo e depois toque no ícone de tela cheia (quadradinho ao lado do som).
            </p>
          )}
        </main>
      </div>

      {showLimitModal && (
        <PlaybackLimitModal
          info={limitInfo}
          onTakeOver={async () => {
            setShowLimitModal(false);
            const result = await claim(true);
            if (result.allowed) {
              try { await videoRef.current?.play?.(); } catch {}
            }
          }}
          onUpgrade={() => navigate("/plans")}
          onCancel={() => setShowLimitModal(false)}
        />
      )}

      {/* Overlay de claim em andamento (só quando flag ativa) */}
      {guardActive && claiming && !claimed && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <Loader2 className="w-10 h-10 animate-spin text-purple-400" />
        </div>
      )}
    </>
  );
}
