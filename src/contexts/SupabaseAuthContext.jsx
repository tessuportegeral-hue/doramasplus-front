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

const LOCAL_SESSION_KEY = 'dp_session_id';
const SESSION_POLL_MS = 5000;
const FAIL_THRESHOLD = 2;
const GRACE_AFTER_LOGIN_MS = 1500;

const PREMIUM_POLL_MS = 2500;
const PREMIUM_POLL_MAX_MS = 60_000;

// =========================
// helpers de sessionId
// =========================
const generateSessionId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

// Retorna { ok: boolean, value: string }
const safeGetLocalSessionId = () => {
  try {
    const v = localStorage.getItem(LOCAL_SESSION_KEY);
    return { ok: true, value: v || '' };
  } catch {
    return { ok: false, value: '' };
  }
};

// Tenta setar e confirma leitura (pra detectar storage instável)
const safeEnsureLocalSessionId = () => {
  try {
    let sid = localStorage.getItem(LOCAL_SESSION_KEY) || '';
    if (!sid) {
      sid = generateSessionId();
      localStorage.setItem(LOCAL_SESSION_KEY, sid);
    }
    // confirma que persistiu
    const check = localStorage.getItem(LOCAL_SESSION_KEY) || '';
    if (!check || check !== sid) return { ok: false, value: '' };
    return { ok: true, value: sid };
  } catch {
    return { ok: false, value: '' };
  }
};

const safeClearLocalSessionId = () => {
  try {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {}
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  // “estado informativo” da regra 1 sessão (sem derrubar ninguém)
  const [checkingSession, setCheckingSession] = useState(false);

  // refs
  const pollRef = useRef(null);
  const activeUserIdRef = useRef(null);
  const sessionFailCountRef = useRef(0);

  // premium refs
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);

  // throttles
  const lastSeenUpdateAtRef = useRef(0);

  // timeouts (pra limpar)
  const timeoutsRef = useRef([]);

  const clearAllTimeouts = useCallback(() => {
    const arr = timeoutsRef.current || [];
    arr.forEach((t) => {
      try {
        clearTimeout(t);
      } catch {}
    });
    timeoutsRef.current = [];
  }, []);

  const stopSessionPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
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
  // PREMIUM
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
  // 1 SESSÃO (SAFE MODE)
  // =========================

  // registra sessão (upsert) — só se storage OK
  const registerSingleSession = useCallback(async (userId) => {
    if (!userId) return { storageOk: false };

    // se storage não é confiável, NÃO aplica regra
    const ensured = safeEnsureLocalSessionId();
    if (!ensured.ok || !ensured.value) return { storageOk: false };

    try {
      const { error } = await supabase.from('user_sessions').upsert(
        {
          user_id: userId,
          session_id: ensured.value,
          updated_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        { onConflict: 'user_id' }
      );

      if (error) throw error;

      return { storageOk: true };
    } catch (err) {
      console.error('Error registering single session:', err);
      // falha de rede/banco não pode derrubar ninguém
      return { storageOk: true };
    }
  }, []);

  // verifica sessão — NUNCA derruba (só retorna ok/false)
  const verifySingleSession = useCallback(async (userId) => {
    if (!userId) return { ok: true, enforced: false };

    const local = safeGetLocalSessionId();
    if (!local.ok) {
      // storage não disponível → não aplica regra
      return { ok: true, enforced: false };
    }

    const sid = local.value || '';
    if (!sid) {
      // storage “vazio” → melhor NÃO aplicar regra (evita loop)
      return { ok: true, enforced: false };
    }

    try {
      const { data, error } = await supabase
        .from('user_sessions')
        .select('session_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      if (!data?.session_id) {
        // não existe registro ainda → tenta registrar, mas sem travar
        await registerSingleSession(userId);
        return { ok: true, enforced: true };
      }

      if (data.session_id !== sid) {
        // conflito detectado
        return { ok: false, enforced: true };
      }

      // atualiza last_seen com throttle (ex.: a cada 30s)
      const now = Date.now();
      if (now - (lastSeenUpdateAtRef.current || 0) > 30_000) {
        lastSeenUpdateAtRef.current = now;
        supabase
          .from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', userId)
          .then(() => {})
          .catch(() => {});
      }

      return { ok: true, enforced: true };
    } catch (err) {
      console.error('Error verifying single session:', err);
      // erro de rede/banco → não aplica punição
      return { ok: true, enforced: true };
    }
  }, [registerSingleSession]);

  const startSessionPolling = useCallback(
    async (userId) => {
      if (!userId) return;

      activeUserIdRef.current = userId;
      sessionFailCountRef.current = 0;

      stopSessionPolling();
      setCheckingSession(true);

      // registra 1x no começo (se der)
      await registerSingleSession(userId);

      pollRef.current = setInterval(async () => {
        const currentUserId = activeUserIdRef.current;
        if (!currentUserId) return;

        const res = await verifySingleSession(currentUserId);

        // se não está “enforced”, não tem o que fiscalizar
        if (res.enforced === false) {
          sessionFailCountRef.current = 0;
          return;
        }

        if (!res.ok) {
          sessionFailCountRef.current += 1;

          if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
            // SAFE MODE: NÃO derruba o usuário.
            // Só para o polling (evita loop) e deixa o login viver.
            stopSessionPolling();
          }
        } else {
          sessionFailCountRef.current = 0;
        }
      }, SESSION_POLL_MS);
    },
    [registerSingleSession, stopSessionPolling, verifySingleSession]
  );

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

        if (error) console.error('Error getting initial session:', error);
        if (!isMounted) return;

        setSession(session ?? null);
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        clearAllTimeouts();
        stopSessionPolling();
        stopPremiumPolling();

        if (currentUser) {
          activeUserIdRef.current = currentUser.id;

          // premium
          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          // sessão (safe)
          const t = setTimeout(() => {
            startSessionPolling(currentUser.id);
          }, GRACE_AFTER_LOGIN_MS);
          timeoutsRef.current.push(t);
        } else {
          activeUserIdRef.current = null;
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

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      const currentUser = session?.user ?? null;

      setSession(session ?? null);
      setUser(currentUser);

      clearAllTimeouts();
      stopSessionPolling();
      stopPremiumPolling();

      if (currentUser) {
        activeUserIdRef.current = currentUser.id;

        // premium
        const t1 = setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        const t2 = setTimeout(() => startPremiumPolling(currentUser.id), 0);
        const t3 = setTimeout(() => startSessionPolling(currentUser.id), GRACE_AFTER_LOGIN_MS);

        timeoutsRef.current.push(t1, t2, t3);
      } else {
        activeUserIdRef.current = null;

        // não precisa limpar storage sempre (mas pode)
        safeClearLocalSessionId();

        setIsPremium(false);
        isPremiumRef.current = false;
        setCheckingPremium(false);
        setCheckingSession(false);
      }

      setLoading(false);
    });

    const subscription = data?.subscription;

    return () => {
      isMounted = false;
      try {
        subscription?.unsubscribe?.();
      } catch {}
      clearAllTimeouts();
      stopSessionPolling();
      stopPremiumPolling();
    };
  }, [
    checkPremiumStatus,
    startPremiumPolling,
    startSessionPolling,
    stopSessionPolling,
    stopPremiumPolling,
    clearAllTimeouts,
  ]);

  // =========================
  // foco/visibilidade → sync premium
  // =========================
  useEffect(() => {
    const onFocus = async () => {
      const uid = activeUserIdRef.current;
      if (!uid) return;

      await checkPremiumStatus(uid);

      if (isPremiumRef.current === false) {
        startPremiumPolling(uid);
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
  }, [checkPremiumStatus, startPremiumPolling]);

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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
