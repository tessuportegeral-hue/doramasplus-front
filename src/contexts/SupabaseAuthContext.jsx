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

// 🔥 EMERGÊNCIA: deixa FALSE pra NÃO aplicar 1 sessão (estabiliza login)
const ENABLE_SINGLE_SESSION = false;

// ✅ chave do localStorage (não muda)
const LOCAL_SESSION_KEY = 'dp_session_id';

// ✅ tempo de verificação (ms)
const SESSION_POLL_MS = 5000;

// ✅ só considera conflito se falhar X vezes seguidas
const FAIL_THRESHOLD = 2;

// ✅ tempo de “graça” após login/refresh (ms)
const GRACE_AFTER_LOGIN_MS = 1500;

// ✅ tempo de sync do premium (ms)
const PREMIUM_POLL_MS = 2500;

// ✅ por quanto tempo tentar sincronizar premium após login/checkout (ms)
const PREMIUM_POLL_MAX_MS = 60_000;

// ✅ cria um session_id robusto
const generateSessionId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

const getLocalSessionId = () => {
  try {
    return localStorage.getItem(LOCAL_SESSION_KEY) || '';
  } catch {
    return '';
  }
};

const setLocalSessionId = (value) => {
  try {
    if (!value) localStorage.removeItem(LOCAL_SESSION_KEY);
    else localStorage.setItem(LOCAL_SESSION_KEY, value);
  } catch {}
};

// (novo) detecta se localStorage é confiável (alguns navegadores/webviews quebram)
const isStorageReliable = () => {
  try {
    const k = '__dp_test_storage__';
    localStorage.setItem(k, '1');
    const ok = localStorage.getItem(k) === '1';
    localStorage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  // ✅ estado da sessão única (não derruba ninguém)
  const [checkingSession, setCheckingSession] = useState(false);

  // refs
  const pollRef = useRef(null);
  const activeUserIdRef = useRef(null);

  const sessionFailCountRef = useRef(0);

  // premium refs
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);

  // timeouts (evita duplicar timers)
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
  // 1 SESSÃO POR VEZ
  // (mantido, mas com proteção + NUNCA dá signOut automático)
  // =========================

  const registerSingleSession = useCallback(async (userId) => {
    if (!ENABLE_SINGLE_SESSION) return;
    if (!userId) return;

    // se storage é instável, não aplica regra
    if (!isStorageReliable()) return;

    setCheckingSession(true);

    try {
      let sid = getLocalSessionId();
      if (!sid) {
        sid = generateSessionId();
        setLocalSessionId(sid);
      }

      const { error } = await supabase.from('user_sessions').upsert(
        {
          user_id: userId,
          session_id: sid,
          updated_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        { onConflict: 'user_id' }
      );

      if (error) throw error;
    } catch (err) {
      console.error('Error registering single session:', err);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  const verifySingleSession = useCallback(
    async (userId) => {
      if (!ENABLE_SINGLE_SESSION) return true;
      if (!userId) return true;

      // se storage é instável, não aplica regra
      if (!isStorageReliable()) return true;

      try {
        const sid = getLocalSessionId();
        if (!sid) {
          // se não tem sid, registra e segue sem punir
          await registerSingleSession(userId);
          return true;
        }

        const { data, error } = await supabase
          .from('user_sessions')
          .select('session_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) throw error;

        if (!data?.session_id) {
          await registerSingleSession(userId);
          return true;
        }

        if (data.session_id !== sid) {
          return false;
        }

        // best-effort last_seen (se falhar não derruba)
        supabase
          .from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', userId)
          .then(() => {})
          .catch(() => {});

        return true;
      } catch (err) {
        console.error('Error verifying single session:', err);
        return true;
      }
    },
    [registerSingleSession]
  );

  const startSessionPolling = useCallback(
    async (userId) => {
      if (!ENABLE_SINGLE_SESSION) return;
      if (!userId) return;

      // se storage é instável, não aplica regra
      if (!isStorageReliable()) return;

      activeUserIdRef.current = userId;
      sessionFailCountRef.current = 0;

      await registerSingleSession(userId);

      stopSessionPolling();

      pollRef.current = setInterval(async () => {
        const currentUserId = activeUserIdRef.current;
        if (!currentUserId) return;

        const ok = await verifySingleSession(currentUserId);

        if (!ok) {
          sessionFailCountRef.current += 1;

          // ✅ IMPORTANTE: NÃO derruba usuário.
          // Só para o polling se detectar conflito real várias vezes.
          if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
            stopSessionPolling();
            // opcional: você pode limpar o sid local pra não ficar insistindo
            // setLocalSessionId('');
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

        clearTimers();

        if (currentUser) {
          activeUserIdRef.current = currentUser.id;

          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          // ✅ grace period
          const t = setTimeout(() => {
            startSessionPolling(currentUser.id);
          }, GRACE_AFTER_LOGIN_MS);
          timersRef.current.push(t);
        } else {
          setIsPremium(false);
          isPremiumRef.current = false;
          setCheckingPremium(false);
          setCheckingSession(false);
          activeUserIdRef.current = null;
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

        const t1 = setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        const t2 = setTimeout(() => startPremiumPolling(currentUser.id), 0);
        const t3 = setTimeout(
          () => startSessionPolling(currentUser.id),
          GRACE_AFTER_LOGIN_MS
        );

        timersRef.current.push(t1, t2, t3);
      } else {
        activeUserIdRef.current = null;
        stopSessionPolling();
        stopPremiumPolling();
        setLocalSessionId('');
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

  // ✅ quando usuário volta pra aba/janela, sincroniza premium
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

    // só pra debug
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
