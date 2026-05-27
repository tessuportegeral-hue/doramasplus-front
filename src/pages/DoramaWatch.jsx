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

// ✅ ROLLOUT GATEADO — quando != null, só este email chama a edge function
// get-stream-url; os demais ficam no caminho legado (lê bunny_url direto
// da row). Com null, TODOS os usuários autenticados passam pela edge e
// recebem URL assinada — necessário quando Token Authentication do Bunny
// está ativo, senão o player recebe URL crua e o Bunny retorna 401.
// Espelho do gate em supabase/functions/get-stream-url/index.ts.
const STREAM_TOKEN_TEST_EMAIL = null;

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

  // device_id lido/gerado uma única vez e mantido estável durante toda a sessão
  const deviceIdRef = useRef(null);
  if (deviceIdRef.current === null) {
    try {
      const stored = localStorage.getItem("dp_device_id");
      if (stored) {
        deviceIdRef.current = stored;
      } else {
        const id = crypto.randomUUID();
        localStorage.setItem("dp_device_id", id);
        deviceIdRef.current = id;
      }
    } catch {
      deviceIdRef.current = crypto.randomUUID();
    }
  }

  // ✅ Tempo salvo vs tempo atual (não deixar virar "espelho" do tempo)
  const [savedSeconds, setSavedSeconds] = useState(0); // vem do banco
  const [liveSeconds, setLiveSeconds] = useState(0); // apenas informativo

  // ✅ Anti-regressão (não deixar 40min virar 10s)
  const hasAppliedResumeRef = useRef(false);
  const lastSavedRef = useRef(0);
  const latestTimeRef = useRef(0);
  const latestDurationRef = useRef(0);

  // ✅ IFRAME: contador local + tempo pra retomar (?t=) — fixado uma vez por dorama
  const iframeLocalCounterRef = useRef(0);
  const [iframeResumeT, setIframeResumeT] = useState(0);

  const WATCH_TABLE = "watch_history";
  const EPISODE_DEFAULT = 1;

  // ✅ TESTE GRÁTIS via IP (edge function)
  const FREE_TRIAL_URL = "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/free-trial";

  const [ipTrialAllowed, setIpTrialAllowed] = useState(false);
  const [ipTrialExpired, setIpTrialExpired] = useState(false);
  const [ipTrialRemaining, setIpTrialRemaining] = useState(0);
  const [ipTrialChecked, setIpTrialChecked] = useState(false);

  // ✅ CLAIM-PLAYBACK: controle de streams simultâneos (só para logado + premium)
  const [claimChecked, setClaimChecked] = useState(false);
  const [claimAllowed, setClaimAllowed] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");

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

  // ✅ Gate de rollout — só tesagencia consome a URL vinda da edge function
  // get-stream-url. Os demais usuários ficam no useMemo legado abaixo,
  // intocado em relação ao que está em produção hoje.
  const useStreamToken =
    !STREAM_TOKEN_TEST_EMAIL || user?.email === STREAM_TOKEN_TEST_EMAIL;

  const [signedVideoUrl, setSignedVideoUrl] = useState("");

  useEffect(() => {
    // Gate em user?.id: garante que o auth hidratou e o JWT está pronto
    // antes de chamar a função. Sem isso, em link direto pra /watch o
    // dorama pode carregar antes do auth, a chamada vai sem Authorization,
    // a função retorna 401 e signedVideoUrl trava em "" pra sempre porque
    // useStreamToken (com TEST_EMAIL=null) já é true desde o início e o
    // effect não re-dispara quando user finalmente chega.
    if (!useStreamToken || !dorama?.id || !user?.id) {
      setSignedVideoUrl("");
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "get-stream-url",
        { body: { dorama_id: dorama.id, mode: isIphoneMode ? "iphone" : "normal" } }
      );
      if (cancelled) return;
      if (fnErr || !data?.url) {
        console.error("[DoramaWatch] get-stream-url falhou:", fnErr);
        setSignedVideoUrl("");
        return;
      }
      setSignedVideoUrl(data.url);
    })();
    return () => { cancelled = true; };
  }, [useStreamToken, dorama?.id, isIphoneMode, user?.id]);

  // ✅ Escolhe URL (normal vs iphone)
  const videoUrl = useMemo(() => {
    // Bifurcação: tesagencia usa URL da edge function; demais, caminho legado.
    if (useStreamToken) return signedVideoUrl;

    if (!dorama) return "";

    const embed = (dorama.bunny_embed_url || "").trim();

    const normal = (dorama.bunny_url || dorama.bunny_stream_url || embed || "").trim();
    const iphone = (dorama.bunny_stream_url || dorama.bunny_url || embed || "").trim();

    return isIphoneMode ? iphone : normal;
  }, [useStreamToken, signedVideoUrl, dorama, isIphoneMode]);

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

  // ✅ autoplay no iframe + retomar via ?t= (Bunny embed lê t em segundos)
  const iframeSrc = useMemo(() => {
    if (playerType !== "iframe") return "";
    const base = (videoUrl || "").trim();
    if (!base) return "";

    const resume = iframeResumeT >= 10 ? Math.floor(iframeResumeT) : 0;

    try {
      const u = new URL(base, window.location.origin);
      if (!u.searchParams.has("autoplay")) u.searchParams.set("autoplay", "true");
      if (resume > 0) u.searchParams.set("t", String(resume));
      u.searchParams.set("_ts", String(Date.now()));
      return u.toString();
    } catch {
      const join = base.includes("?") ? "&" : "?";
      const tParam = resume > 0 ? `&t=${resume}` : "";
      return `${base}${join}autoplay=true${tParam}&_ts=${Date.now()}`;
    }
  }, [videoUrl, playerType, iframeResumeT]);

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
  }, [videoUrl, playerType, claimAllowed]);

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
    return playerType === "mp4" || playerType === "hls" || playerType === "video" || playerType === "iframe";
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

  // ✅ CLAIM-PLAYBACK: verifica limite de streams e mantém heartbeat
  useEffect(() => {
    if (!isAuthenticated || !isPremium || !dorama?.id || loading || checkingPremium) return;

    setClaimChecked(false);
    setClaimAllowed(false);
    setClaimMessage("");

    let heartbeatId;
    let active = true;

    const callClaim = async (force = false) => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return null;

        const deviceId = deviceIdRef.current;

        const ua = navigator.userAgent || "";
        const deviceName =
          /iPhone/i.test(ua) ? "iPhone" :
          /iPad/i.test(ua) ? "iPad" :
          /Android/i.test(ua) ? "Android" :
          /Windows/i.test(ua) ? "Windows" :
          /Mac/i.test(ua) ? "Mac" : "Navegador";

        const res = await fetch(
          "https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/claim-playback",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ device_id: deviceId, device_name: deviceName, force }),
          }
        );
        return await res.json();
      } catch {
        return null;
      }
    };

    (async () => {
      const data = await callClaim(false);
      if (!active) return;
      setClaimChecked(true);

      if (data === null) {
        // falha de rede: fail open para não bloquear usuários legítimos
        setClaimAllowed(true);
        return;
      }

      if (!data.allowed) {
        setClaimAllowed(false);
        setClaimMessage(data.message || "Limite de reproduções simultâneas atingido.");
        return;
      }

      setClaimAllowed(true);

      const interval = Math.max(10, data.heartbeat_interval_seconds ?? 30) * 1000;
      heartbeatId = setInterval(async () => {
        const ping = await callClaim(false);
        if (!active) return;
        if (ping !== null && !ping.allowed) {
          clearInterval(heartbeatId);
          setClaimAllowed(false);
          setClaimMessage(ping.message || "Sessão encerrada em outro dispositivo.");
          try {
            const el = videoRef.current;
            if (el && typeof el.pause === "function") el.pause();
          } catch {}
        }
      }, interval);
    })();

    return () => {
      active = false;
      clearInterval(heartbeatId);
    };
  }, [isAuthenticated, isPremium, dorama?.id, loading, checkingPremium]);

  // ✅ Carrega tempo salvo do banco
  useEffect(() => {
    if (!allowContinue) {
      setSavedSeconds(0);
      setLiveSeconds(0);
      lastSavedRef.current = 0;
      hasAppliedResumeRef.current = false;
      iframeLocalCounterRef.current = 0;
      setIframeResumeT(0);
      return;
    }

    iframeLocalCounterRef.current = 0;
    setIframeResumeT(0);

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
        iframeLocalCounterRef.current = saved;
        setIframeResumeT(saved);
      } catch (err) {
        console.error("watch_history select fatal:", err);
        setSavedSeconds(0);
        setLiveSeconds(0);
        lastSavedRef.current = 0;
        hasAppliedResumeRef.current = false;
        iframeLocalCounterRef.current = 0;
        setIframeResumeT(0);
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
      if (document.visibilityState === "hidden") {
        flush();
        try { el.pause(); } catch {}
      }
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
  }, [allowContinue, videoUrl, dorama?.id, user?.id, claimAllowed]);

  // ✅ TRACKING DO IFRAME (Bunny embed) — postMessage + fallback contador local
  useEffect(() => {
    if (!allowContinue) return;
    if (playerType !== "iframe") return;
    if (!user?.id || !dorama?.id) return;
    if (!claimAllowed) return; // só rastreia se o player estiver realmente liberado/renderizado

    let isPaused = false;
    let lastRealTime = 0;
    let lastRealTimeAt = 0;

    const onMessage = (e) => {
      let data = e.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return; }
      }
      if (!data || typeof data !== "object") return;

      const evt = data.type || data.event || data.message;
      if (evt === "pause" || evt === "paused") isPaused = true;
      else if (evt === "play" || evt === "playing") isPaused = false;

      const t = data.currentTime ?? data.time ?? data.position ?? data.seconds;
      if (typeof t === "number" && isFinite(t) && t > 0) {
        lastRealTime = t;
        lastRealTimeAt = Date.now();
      }
    };

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      if (isPaused) return;

      const now = Date.now();
      if (lastRealTime > 0 && now - lastRealTimeAt < 15_000) {
        // postMessage entregou um tempo real recente — usa ele
        iframeLocalCounterRef.current = Math.floor(lastRealTime);
      } else {
        // fallback: incrementa 5s
        iframeLocalCounterRef.current += 5;
      }

      saveProgress(iframeLocalCounterRef.current, 0);
    };

    const flush = () => {
      if (iframeLocalCounterRef.current > 0) {
        saveProgress(iframeLocalCounterRef.current, 0);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onBeforeUnload = () => flush();

    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    const intervalId = setInterval(tick, 5_000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowContinue, playerType, dorama?.id, user?.id, claimAllowed]);

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
  if (loading || loadingDorama || (isAuthenticated && checkingPremium) || (!isAuthenticated && !ipTrialChecked) || (isAuthenticated && isPremium && !checkingPremium && !claimChecked)) {
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
              ) : isAuthenticated && isPremium && !claimAllowed ? (
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
                  controlsList="nodownload"
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  playsInline
                  autoPlay
                  preload="auto"
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

              {/* ✅ OVERLAY: claim-playback bloqueado */}
              {isAuthenticated && isPremium && claimChecked && !claimAllowed && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 px-6 text-center">
                  <p className="text-white text-lg font-semibold mb-2">
                    Limite de reproduções simultâneas atingido
                  </p>
                  <p className="text-slate-300 text-sm">
                    {claimMessage}
                  </p>
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
