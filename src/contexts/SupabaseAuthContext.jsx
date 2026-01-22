import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { supabase } from "@/lib/supabaseClient";

const AuthContext = createContext(null);

// =========================
// ✅ CONFIG
// =========================

// ✅ ATIVA a regra de 1 dispositivo por vez (Netflix mode)
const ENABLE_SINGLE_SESSION = true;

// ✅ Edge Functions (nomes que você criou no Supabase)
const START_SESSION_FN = "start-session";
const VALIDATE_SESSION_FN = "validate-session";

// ✅ tempo de verificação (ms) — (AJUSTADO) mais leve pra não derrubar por falso positivo
const SESSION_POLL_MS = 12_000;

// ✅ grace após login/refresh (ms) — (AJUSTADO) mais folga
const GRACE_AFTER_LOGIN_MS = 2_500;

// ✅ premium
const PREMIUM_POLL_MS = 2500;
const PREMIUM_POLL_MAX_MS = 60_000;

// ✅ (ADICIONADO) Quantas falhas seguidas antes de derrubar
const INVALID_STREAK_LIMIT = 3;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  // ✅ estado da sessão única
  const [checkingSession, setCheckingSession] = useState(false);

  // refs
  const pollRef = useRef(null);
  const activeUserIdRef = useRef(null);

  // guarda a versão da sessão retornada pelo backend
  const sessionVersionRef = useRef(null);

  // evita corrida (duas chamadas ao mesmo tempo)
  const startInFlightRef = useRef(false);
  const validateInFlightRef = useRef(false);

  // premium refs
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);

  // timeouts (evita duplicar timers)
  const timersRef = useRef([]);

  // ✅ (ADICIONADO) controle de falso positivo: só derruba se falhar várias vezes seguidas
  const invalidStreakRef = useRef(0);

  const clearTimers = useCallback(() => {
    (timersRef.current || []).forEach((t) => {
      try {
        clearTimeout(t);
      } catch {}
    });
    timersRef.current = [];
  }, []);

  const stopSessionPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setCheckingSession(false);
  }, []);

  const stopPremiumPolling = useCallback(() => {
    if (premiumPollRef.current) {
      clearInterval(premiumPollRef.current);
      premiumPollRef.current = null;
    }
    premiumPollStartedAtRef.current = 0;
  }, []);

  // =========================
  // PREMIUM (mantido)
  // =========================
  const checkPremiumStatus = useCallback(
    async (userId) => {
      if (!userId) {
        setIsPremium(false);
        isPremiumRef.current = false;
        setCheckingPremium(false);
        return;
      }

      setCheckingPremium(true);

      try {
        const { data: subscriptions, error } = await supabase
          .from("subscriptions")
          .select("status, end_at, current_period_end")
          .eq("user_id", userId)
          .in("status", ["active", "trialing"]);

        if (error) throw error;

        const now = new Date();
        const subs = subscriptions || [];

        const hasActiveSub = subs.some((sub) => {
          const endDate = sub.end_at || sub.current_period_end;
          return endDate && new Date(endDate) > now;
        });

        setIsPremium(hasActiveSub);
        isPremiumRef.current = hasActiveSub;

        if (hasActiveSub) stopPremiumPolling();
      } catch (err) {
        console.error("Error checking premium status:", err);
        setIsPremium(false);
        isPremiumRef.current = false;
      } finally {
        setCheckingPremium(false);
      }
    },
    [stopPremiumPolling]
  );

  const startPremiumPolling = useCallback(
    async (userId) => {
      if (!userId) return;

      if (isPremiumRef.current === true) {
        stopPremiumPolling();
        return;
      }

      if (premiumPollRef.current) return;

      premiumPollStartedAtRef.current = Date.now();

      await checkPremiumStatus(userId);

      if (isPremiumRef.current === true) {
        stopPremiumPolling();
        return;
      }

      premiumPollRef.current = setInterval(async () => {
        const startedAt = premiumPollStartedAtRef.current || 0;
        const elapsed = Date.now() - startedAt;

        if (elapsed > PREMIUM_POLL_MAX_MS) {
          stopPremiumPolling();
          return;
        }

        if (isPremiumRef.current === true) {
          stopPremiumPolling();
          return;
        }

        await checkPremiumStatus(userId);
      }, PREMIUM_POLL_MS);
    },
    [checkPremiumStatus, stopPremiumPolling]
  );

  // =========================
  // ✅ 1 DISPOSITIVO (EDGE FUNCTIONS)
  // =========================

  const startSingleSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    if (!activeUserIdRef.current) return true;

    if (startInFlightRef.current) return true;
    startInFlightRef.current = true;

    setCheckingSession(true);

    try {
      // chama a edge function que "toma posse" da sessão
      const { data, error } = await supabase.functions.invoke(START_SESSION_FN, {
        body: {
          user_agent:
            typeof navigator !== "undefined" ? navigator.userAgent : null,
        },
      });

      if (error) throw error;

      // aceita qualquer um desses formatos (pra não quebrar se você mudou no backend)
      const v =
        data?.session_version ||
        data?.sessionVersion ||
        data?.session ||
        data?.version ||
        null;

      if (!v) {
        console.warn("[start-session] resposta sem session_version:", data);
        // não derruba por isso, só não aplica regra
        sessionVersionRef.current = null;
        return true;
      }

      sessionVersionRef.current = String(v);

      // ✅ (ADICIONADO) se conseguiu iniciar sessão, zera streak
      invalidStreakRef.current = 0;

      return true;
    } catch (e) {
      console.error("Error startSingleSession:", e);
      // se a function falhar, não derruba geral
      sessionVersionRef.current = null;
      return true;
    } finally {
      startInFlightRef.current = false;
      setCheckingSession(false);
    }
  }, []);

  const validateSingleSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    const uid = activeUserIdRef.current;
    if (!uid) return true;

    // se por algum motivo não temos version, tenta iniciar de novo 1x
    if (!sessionVersionRef.current) {
      await startSingleSession();
      if (!sessionVersionRef.current) return true; // sem versão = não pune
    }

    if (validateInFlightRef.current) return true;
    validateInFlightRef.current = true;

    try {
      const { data, error } = await supabase.functions.invoke(
        VALIDATE_SESSION_FN,
        {
          body: { session_version: sessionVersionRef.current },
        }
      );

      if (error) throw error;

      const valid =
        data?.valid ??
        data?.is_valid ??
        data?.ok ??
        (data?.status ? data.status === "ok" : undefined);

      // se não veio bool, não derruba (pra não dar falso positivo)
      if (typeof valid !== "boolean") {
        console.warn("[validate-session] resposta inesperada:", data);
        return true;
      }

      return valid;
    } catch (e) {
      console.error("Error validateSingleSession:", e);
      // erro de rede/function = não derruba
      return true;
    } finally {
      validateInFlightRef.current = false;
    }
  }, [startSingleSession]);

  const forceSignOut = useCallback(async () => {
    try {
      stopSessionPolling();
      sessionVersionRef.current = null;
      activeUserIdRef.current = null;
      invalidStreakRef.current = 0;
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Error signOut:", e);
    }
  }, [stopSessionPolling]);

  const startSessionPolling = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return;
    if (!activeUserIdRef.current) return;

    stopSessionPolling();

    // ✅ sempre “toma posse” quando entrar
    await startSingleSession();

    pollRef.current = setInterval(async () => {
      const ok = await validateSingleSession();

      if (!ok) {
        // ✅ (ALTERADO) Não derruba na 1ª — só após X falhas seguidas
        invalidStreakRef.current = (invalidStreakRef.current || 0) + 1;

        if (invalidStreakRef.current >= INVALID_STREAK_LIMIT) {
          await forceSignOut();
        }
        return;
      }

      // ✅ se validou, zera o contador
      invalidStreakRef.current = 0;
    }, SESSION_POLL_MS);
  }, [forceSignOut, startSingleSession, stopSessionPolling, validateSingleSession]);

  // =========================
  // INIT + AUTH LISTENER
  // =========================
  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      try {
        setLoading(true);

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) console.error("Error getting initial session:", error);
        if (!isMounted) return;

        setSession(session ?? null);
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        clearTimers();

        if (currentUser) {
          activeUserIdRef.current = currentUser.id;
          invalidStreakRef.current = 0;

          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          // ✅ inicia controle de sessão após um pequeno grace
          const t = setTimeout(() => {
            startSessionPolling();
          }, GRACE_AFTER_LOGIN_MS);
          timersRef.current.push(t);
        } else {
          setIsPremium(false);
          isPremiumRef.current = false;
          setCheckingPremium(false);
          setCheckingSession(false);
          activeUserIdRef.current = null;
          sessionVersionRef.current = null;
          invalidStreakRef.current = 0;
          stopSessionPolling();
          stopPremiumPolling();
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      const currentUser = session?.user ?? null;
      setSession(session ?? null);
      setUser(currentUser);

      clearTimers();

      if (currentUser) {
        activeUserIdRef.current = currentUser.id;
        invalidStreakRef.current = 0;

        const t1 = setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        const t2 = setTimeout(() => startPremiumPolling(currentUser.id), 0);

        // ✅ toda vez que loga / volta sessão → toma posse
        const t3 = setTimeout(() => startSessionPolling(), GRACE_AFTER_LOGIN_MS);

        timersRef.current.push(t1, t2, t3);
      } else {
        activeUserIdRef.current = null;
        sessionVersionRef.current = null;
        invalidStreakRef.current = 0;
        stopSessionPolling();
        stopPremiumPolling();
        setIsPremium(false);
        isPremiumRef.current = false;
        setCheckingPremium(false);
        setCheckingSession(false);
      }

      setLoading(false);
    });

    return () => {
      isMounted = false;
      try {
        subscription.unsubscribe();
      } catch {}
      clearTimers();
      stopSessionPolling();
      stopPremiumPolling();
    };
  }, [
    checkPremiumStatus,
    startPremiumPolling,
    startSessionPolling,
    stopSessionPolling,
    stopPremiumPolling,
    clearTimers,
  ]);

  // ✅ quando usuário volta pra aba/janela:
  // (ALTERADO) NÃO derruba mais no foco/visibility — só tenta "tomar posse" e revalidar sem expulsar
  useEffect(() => {
    const onFocus = async () => {
      if (!activeUserIdRef.current) return;

      await checkPremiumStatus(activeUserIdRef.current);
      if (isPremiumRef.current === false) startPremiumPolling(activeUserIdRef.current);

      // ✅ em vez de derrubar, tenta reassumir e zera streak
      await startSingleSession();
      invalidStreakRef.current = 0;
    };

    const onVisibility = async () => {
      if (document.visibilityState === "visible") {
        await onFocus();
      }
    };

    try {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
    } catch {}

    return () => {
      try {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
      } catch {}
    };
  }, [checkPremiumStatus, startPremiumPolling, startSingleSession]);

  const refreshPremiumStatus = useCallback(() => {
    if (user) {
      checkPremiumStatus(user.id);
      if (isPremiumRef.current === false) startPremiumPolling(user.id);
    }
  }, [user, checkPremiumStatus, startPremiumPolling]);

  const value = {
    user,
    session,
    loading,
    isAuthenticated: !!user,

    isPremium,
    checkingPremium,
    refreshPremiumStatus,

    checkingSession,

    // debug
    singleSessionEnabled: ENABLE_SINGLE_SESSION,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
