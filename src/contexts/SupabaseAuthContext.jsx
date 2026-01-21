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

// ✅ chave do device (usado no Dashboard.jsx também)
const DEVICE_KEY = 'dp_device_id';

// ✅ tempo de verificação (ms)
const SESSION_POLL_MS = 5000;

// ✅ só derruba se falhar X vezes seguidas (evita falso positivo)
const FAIL_THRESHOLD = 2;

// ✅ tempo de “graça” após login/refresh de sessão (ms)
const GRACE_AFTER_LOGIN_MS = 1500;

// ✅ tempo de sync do premium (ms)
const PREMIUM_POLL_MS = 2500;

// ✅ por quanto tempo tentar sincronizar premium após login/checkout (ms)
const PREMIUM_POLL_MAX_MS = 60_000;

// ✅ gera id robusto
const generateId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

const getLocal = (key) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const setLocal = (key, value) => {
  try {
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

// ✅ garante device_id no navegador (NUNCA deixa vazio)
const ensureDeviceId = () => {
  let did = getLocal(DEVICE_KEY);
  if (!did) {
    did = generateId();
    setLocal(DEVICE_KEY, did);
  }
  return did;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  // ✅ estado da checagem de sessão única
  const [checkingSession, setCheckingSession] = useState(false);

  // refs pra controlar interval/estado sem bug de render
  const pollRef = useRef(null);
  const activeUserIdRef = useRef(null);

  // ✅ contador de falhas seguidas (pra evitar derrubar por lag)
  const sessionFailCountRef = useRef(0);

  // ✅ refs do sync premium
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);

  const stopSessionPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    sessionFailCountRef.current = 0;
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
  // ✅ 1 DISPOSITIVO POR VEZ (DEVICE_ID)
  // =========================

  const registerSingleDevice = useCallback(async (userId) => {
    if (!userId) return;

    setCheckingSession(true);

    try {
      const deviceId = ensureDeviceId();

      const { error } = await supabase.from('user_sessions').upsert(
        {
          user_id: userId,
          device_id: deviceId,
          updated_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        },
        { onConflict: 'user_id' }
      );

      if (error) throw error;
    } catch (err) {
      console.error('Error registering single device:', err);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  const verifySingleDevice = useCallback(
    async (userId) => {
      if (!userId) return true;

      try {
        const deviceId = ensureDeviceId();

        const { data, error } = await supabase
          .from('user_sessions')
          .select('device_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) throw error;

        // se não tem registro ainda, registra e não derruba
        if (!data?.device_id) {
          await registerSingleDevice(userId);
          return true;
        }

        // se divergir, outro device assumiu
        if (data.device_id !== deviceId) {
          return false;
        }

        // heartbeat
        await supabase
          .from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', userId);

        return true;
      } catch (err) {
        console.error('Error verifying single device:', err);
        // em erro, NÃO derruba (evita falso positivo)
        return true;
      }
    },
    [registerSingleDevice]
  );

  const startDevicePolling = useCallback(
    async (userId) => {
      if (!userId) return;

      activeUserIdRef.current = userId;
      sessionFailCountRef.current = 0;

      await registerSingleDevice(userId);

      stopSessionPolling();

      pollRef.current = setInterval(async () => {
        const currentUserId = activeUserIdRef.current;
        if (!currentUserId) return;

        const ok = await verifySingleDevice(currentUserId);

        if (!ok) {
          sessionFailCountRef.current += 1;

          if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
            stopSessionPolling();
            try {
              await supabase.auth.signOut();
            } catch {}
            // opcional: redireciona com motivo
            try {
              window.location.href = '/login?reason=other_device';
            } catch {}
          }
        } else {
          sessionFailCountRef.current = 0;
        }
      }, SESSION_POLL_MS);
    },
    [registerSingleDevice, stopSessionPolling, verifySingleDevice]
  );

  // =========================
  // INIT + AUTH LISTENER
  // =========================
  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      try {
        setLoading(true);

        // ✅ garante device_id já no boot
        ensureDeviceId();

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error('Error getting initial session:', error);
        }

        if (!isMounted) return;

        setSession(session ?? null);
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          setTimeout(() => {
            startDevicePolling(currentUser.id);
          }, GRACE_AFTER_LOGIN_MS);
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

      // ✅ garante device_id sempre que muda auth
      ensureDeviceId();

      const currentUser = session?.user ?? null;
      setSession(session ?? null);
      setUser(currentUser);

      if (currentUser) {
        activeUserIdRef.current = currentUser.id;

        setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        setTimeout(() => startPremiumPolling(currentUser.id), 0);

        setTimeout(() => {
          startDevicePolling(currentUser.id);
        }, GRACE_AFTER_LOGIN_MS);
      } else {
        activeUserIdRef.current = null;
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
      stopSessionPolling();
      stopPremiumPolling();
    };
  }, [
    checkPremiumStatus,
    startPremiumPolling,
    startDevicePolling,
    stopSessionPolling,
    stopPremiumPolling,
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
