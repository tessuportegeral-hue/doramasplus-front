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

// Liga/desliga o bloqueio 1 dispositivo
const ENABLE_SINGLE_SESSION = true;

// Intervalo de verificação (ms)
const SESSION_POLL_MS = 4000;

// Quantas falhas seguidas antes de derrubar (evita falso positivo por rede ruim)
const FAIL_THRESHOLD = 2;

// Tempo de “graça” depois do login (ms)
const GRACE_AFTER_LOGIN_MS = 1200;

// Premium polling
const PREMIUM_POLL_MS = 2500;
const PREMIUM_POLL_MAX_MS = 60_000;

// Nome das Edge Functions
const FN_START_SESSION = "start-session";
const FN_VALIDATE_SESSION = "validate-session";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  // debug/status
  const [checkingSession, setCheckingSession] = useState(false);

  // refs
  const activeUserIdRef = useRef(null);

  const sessionVersionRef = useRef(null); // <-- o "token" do dispositivo atual
  const sessionPollRef = useRef(null);
  const sessionFailCountRef = useRef(0);

  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);

  const timersRef = useRef([]);

  const clearTimers = useCallback(() => {
    (timersRef.current || []).forEach((t) => {
      try {
        clearTimeout(t);
      } catch {}
    });
    timersRef.current = [];
  }, []);

  const stopSessionPolling = useCallback(() => {
    if (sessionPollRef.current) {
      clearInterval(sessionPollRef.current);
      sessionPollRef.current = null;
    }
    sessionFailCountRef.current = 0;
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
  // ✅ PREMIUM (igual você já tinha)
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
  // ✅ 1 DISPOSITIVO (Edge Functions)
  // =========================

  // 1) Inicia sessão (gera session_version no backend e devolve pro frontend)
  const startSingleSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return null;

    setCheckingSession(true);

    try {
      // OBS: supabase já manda Authorization automaticamente (se estiver logado)
      const { data, error } = await supabase.functions.invoke(FN_START_SESSION, {
        body: {},
      });

      if (error) throw error;

      const version = data?.session_version || null;
      if (!version) {
        console.warn(
          "[single-session] start-session não retornou session_version:",
          data
        );
      }

      sessionVersionRef.current = version;
      return version;
    } catch (e) {
      console.error("[single-session] Erro no start-session:", e);
      // se falhar, não derruba — só não aplica ainda
      sessionVersionRef.current = null;
      return null;
    } finally {
      setCheckingSession(false);
    }
  }, []);

  // 2) Valida a sessão atual (se mudou no backend => derruba)
  const validateSingleSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;

    const currentVersion = sessionVersionRef.current;
    if (!currentVersion) {
      // se não tem version ainda, tenta criar
      const v = await startSingleSession();
      return !!v; // se criou, ok; se não criou, não derruba
    }

    try {
      const { data, error } = await supabase.functions.invoke(
        FN_VALIDATE_SESSION,
        {
          body: { session_version: currentVersion },
        }
      );

      if (error) throw error;

      // contrato esperado:
      // data = { valid: boolean }
      const valid = data?.valid;

      if (typeof valid !== "boolean") {
        console.warn(
          "[single-session] validate-session retornou formato inesperado:",
          data
        );
        // não derruba por retorno estranho
        return true;
      }

      return valid;
    } catch (e) {
      console.error("[single-session] Erro no validate-session:", e);
      // rede ruim ≠ derrubar; tratamos no FAIL_THRESHOLD
      return true;
    }
  }, [startSingleSession]);

  // 3) Polling que derruba mesmo
  const startSessionPolling = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return;
    if (!activeUserIdRef.current) return;

    // evita múltiplos polls
    stopSessionPolling();

    // garante session_version inicial
    await startSingleSession();

    sessionFailCountRef.current = 0;

    sessionPollRef.current = setInterval(async () => {
      if (!activeUserIdRef.current) return;

      const ok = await validateSingleSession();

      if (!ok) {
        sessionFailCountRef.current += 1;

        if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
          // derruba com força
          stopSessionPolling();

          try {
            await supabase.auth.signOut();
          } catch (e) {
            console.error("[single-session] erro no signOut:", e);
          }

          // limpa version local
          sessionVersionRef.current = null;
        }
      } else {
        sessionFailCountRef.current = 0;
      }
    }, SESSION_POLL_MS);
  }, [startSingleSession, stopSessionPolling, validateSingleSession]);

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

          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          // inicia single-session após grace
          const t = setTimeout(() => {
            startSessionPolling();
          }, GRACE_AFTER_LOGIN_MS);
          timersRef.current.push(t);
        } else {
          activeUserIdRef.current = null;
          sessionVersionRef.current = null;

          stopSessionPolling();
          stopPremiumPolling();

          setIsPremium(false);
          isPremiumRef.current = false;
          setCheckingPremium(false);
          setCheckingSession(false);
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

        const t1 = setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        const t2 = setTimeout(() => startPremiumPolling(currentUser.id), 0);

        // MUITO IMPORTANTE:
        // sempre que loga, cria uma NOVA session_version.
        const t3 = setTimeout(async () => {
          // start-session primeiro
          await startSingleSession();
          // depois polling
          await startSessionPolling();
        }, GRACE_AFTER_LOGIN_MS);

        timersRef.current.push(t1, t2, t3);
      } else {
        activeUserIdRef.current = null;
        sessionVersionRef.current = null;

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
    stopPremiumPolling,
    startSingleSession,
    startSessionPolling,
    stopSessionPolling,
    clearTimers,
  ]);

  // ✅ quando volta pra aba, valida sessão + sincroniza premium
  useEffect(() => {
    const onFocus = async () => {
      if (!activeUserIdRef.current) return;

      // premium
      await checkPremiumStatus(activeUserIdRef.current);
      if (isPremiumRef.current === false) startPremiumPolling(activeUserIdRef.current);

      // sessão
      if (ENABLE_SINGLE_SESSION) {
        const ok = await validateSingleSession();
        if (!ok) {
          try {
            await supabase.auth.signOut();
          } catch {}
          sessionVersionRef.current = null;
        }
      }
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
  }, [checkPremiumStatus, startPremiumPolling, validateSingleSession]);

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

    // sessão única
    checkingSession,
    singleSessionEnabled: ENABLE_SINGLE_SESSION,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
