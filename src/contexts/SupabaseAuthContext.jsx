import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { supabase } from '@/lib/supabaseClient';

const AuthContext = createContext(null);

// =========================
// ✅ CONFIG
// =========================

// ✅ LIGA o novo sistema (Edge Functions) de 1 sessão por vez
const ENABLE_SINGLE_SESSION = true;

// ✅ polling de validação (ms)
const SESSION_POLL_MS = 4000;

// ✅ se der erro de rede/função, quantas vezes seguidas antes de parar o polling (NÃO desloga por erro)
const FAIL_THRESHOLD = 3;

// ✅ tempo de “graça” após login/refresh (ms)
const GRACE_AFTER_LOGIN_MS = 1200;

// ✅ tempo de sync do premium (ms)
const PREMIUM_POLL_MS = 2500;

// ✅ por quanto tempo tentar sincronizar premium após login/checkout (ms)
const PREMIUM_POLL_MAX_MS = 60_000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  // ✅ estado visual/debug (não trava nada)
  const [checkingSession, setCheckingSession] = useState(false);

  // =========================
  // REFS
  // =========================
  const activeUserIdRef = useRef(null);

  // premium refs
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);

  // timeouts (evita duplicar timers)
  const timersRef = useRef([]);

  // ✅ NOVO: session_version em memória
  const sessionVersionRef = useRef(null);

  // ✅ NOVO: intervalo do validate-session
  const sessionPollRef = useRef(null);

  // ✅ NOVO: contador de falhas de chamada (rede/edge) — não derruba por isso
  const sessionFailCountRef = useRef(0);

  const clearTimers = useCallback(() => {
    (timersRef.current || []).forEach((t) => {
      try {
        clearTimeout(t);
      } catch {}
    });
    timersRef.current = [];
  }, []);

  // =========================
  // ✅ STOPPERS
  // =========================
  const stopPremiumPolling = useCallback(() => {
    if (premiumPollRef.current) {
      clearInterval(premiumPollRef.current);
      premiumPollRef.current = null;
    }
    premiumPollStartedAtRef.current = 0;
  }, []);

  const stopSessionPolling = useCallback(() => {
    if (sessionPollRef.current) {
      clearInterval(sessionPollRef.current);
      sessionPollRef.current = null;
    }
    sessionFailCountRef.current = 0;
    setCheckingSession(false);
  }, []);

  const clearSingleSessionMemory = useCallback(() => {
    sessionVersionRef.current = null;
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
          .from('subscriptions')
          .select('status, end_at, current_period_end')
          .eq('user_id', userId)
          .in('status', ['active', 'trialing']);

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
        console.error('Error checking premium status:', err);
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
  // ✅ NOVO: 1 SESSÃO POR VEZ (Edge Functions)
  // =========================

  const startEdgeSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return;

    setCheckingSession(true);

    try {
      // start-session não precisa body. Ele usa o Authorization do usuário logado.
      const { data, error } = await supabase.functions.invoke('start-session');

      if (error) {
        console.error('start-session error:', error);
        return;
      }

      const v = data?.session_version;
      if (!v) {
        console.error('start-session: resposta sem session_version', data);
        return;
      }

      sessionVersionRef.current = v;
      sessionFailCountRef.current = 0;
    } catch (e) {
      console.error('start-session exception:', e);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  const validateEdgeSessionOnce = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return { ok: true };
    const v = sessionVersionRef.current;
    if (!v) return { ok: true };

    try {
      const { data, error } = await supabase.functions.invoke('validate-session', {
        body: { session_version: v },
      });

      // erro de rede/edge: NÃO derruba (pra não repetir o inferno de ontem)
      if (error) {
        return { ok: true, softError: true, details: error };
      }

      // se o backend disse "invalid", aí é conflito REAL => derruba
      if (data?.valid === false) {
        return { ok: false, conflict: true };
      }

      return { ok: true };
    } catch (e) {
      return { ok: true, softError: true, details: e };
    }
  }, []);

  const beginEdgeSessionPolling = useCallback(() => {
    if (!ENABLE_SINGLE_SESSION) return;
    if (sessionPollRef.current) return;

    sessionFailCountRef.current = 0;

    sessionPollRef.current = setInterval(async () => {
      const res = await validateEdgeSessionOnce();

      if (res?.conflict === true) {
        // conflito real: derruba a sessão antiga
        stopSessionPolling();
        clearSingleSessionMemory();

        try {
          await supabase.auth.signOut();
        } catch {}
        return;
      }

      if (res?.softError) {
        sessionFailCountRef.current += 1;

        // muita falha seguida: para o polling pra não martelar
        if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
          stopSessionPolling();
          // não desloga, só para (usuário não sofre por instabilidade)
        }
      } else {
        sessionFailCountRef.current = 0;
      }
    }, SESSION_POLL_MS);
  }, [validateEdgeSessionOnce, stopSessionPolling, clearSingleSessionMemory]);

  const startSingleSessionFlow = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return;

    // evita duplicar
    stopSessionPolling();
    clearSingleSessionMemory();

    // 1) cria a sessão "dona" no banco e pega session_version
    await startEdgeSession();

    // 2) começa polling de validação
    if (sessionVersionRef.current) {
      beginEdgeSessionPolling();
    }
  }, [startEdgeSession, beginEdgeSessionPolling, stopSessionPolling, clearSingleSessionMemory]);

  // =========================
  // INIT + AUTH LISTENER
  // =========================
  useEffect(() => {
    let isMounted = true;

    const resetAll = () => {
      activeUserIdRef.current = null;
      stopSessionPolling();
      clearSingleSessionMemory();
      stopPremiumPolling();
      setIsPremium(false);
      isPremiumRef.current = false;
      setCheckingPremium(false);
      setCheckingSession(false);
    };

    const initSession = async () => {
      try {
        setLoading(true);

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) console.error('Error getting initial session:', error);
        if (!isMounted) return;

        setSession(session ?? null);
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        clearTimers();

        if (currentUser) {
          activeUserIdRef.current = currentUser.id;

          // premium
          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          // single-session (Edge) com grace
          const t = setTimeout(() => {
            startSingleSessionFlow();
          }, GRACE_AFTER_LOGIN_MS);
          timersRef.current.push(t);
        } else {
          resetAll();
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

        // importante: em SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION,
        // a gente sempre garante o single-session flow (com grace)
        const t3 = setTimeout(() => startSingleSessionFlow(), GRACE_AFTER_LOGIN_MS);

        timersRef.current.push(t1, t2, t3);
      } else {
        resetAll();
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
      clearSingleSessionMemory();
      stopPremiumPolling();
    };
  }, [
    checkPremiumStatus,
    startPremiumPolling,
    startSingleSessionFlow,
    stopSessionPolling,
    stopPremiumPolling,
    clearTimers,
    clearSingleSessionMemory,
  ]);

  // ✅ quando usuário volta pra aba/janela, sincroniza premium
  useEffect(() => {
    const onFocus = async () => {
      const uid = activeUserIdRef.current;
      if (!uid) return;

      await checkPremiumStatus(uid);

      if (isPremiumRef.current === false) {
        startPremiumPolling(uid);
      }

      // opcional: valida sessão ao voltar foco (deixa mais rápido pra derrubar o antigo)
      if (ENABLE_SINGLE_SESSION && sessionVersionRef.current) {
        const res = await validateEdgeSessionOnce();
        if (res?.conflict === true) {
          stopSessionPolling();
          clearSingleSessionMemory();
          try {
            await supabase.auth.signOut();
          } catch {}
        }
      }
    };

    const onVisibility = async () => {
      if (document.visibilityState === 'visible') {
        await onFocus();
      }
    };

    try {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    } catch {}

    return () => {
      try {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      } catch {}
    };
  }, [checkPremiumStatus, startPremiumPolling, validateEdgeSessionOnce, stopSessionPolling, clearSingleSessionMemory]);

  const refreshPremiumStatus = useCallback(() => {
    if (user) {
      checkPremiumStatus(user.id);

      if (isPremiumRef.current === false) {
        startPremiumPolling(user.id);
      }
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
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
