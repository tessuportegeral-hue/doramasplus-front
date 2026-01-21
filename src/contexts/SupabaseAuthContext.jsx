// src/contexts/SupabaseAuthContext.jsx
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

// ✅ chave do localStorage (não muda)
const LOCAL_SESSION_KEY = 'dp_session_id';

// ✅ (NOVO) device id do aparelho (pra 1 dispositivo por vez)
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

// ✅ cria um id robusto
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

// ✅ (NOVO) garante device_id no browser SEM derrubar login
const ensureDeviceId = () => {
  let deviceId = getLocal(DEVICE_KEY);
  if (!deviceId) {
    deviceId = generateId();
    setLocal(DEVICE_KEY, deviceId);
  }
  return deviceId;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  const [checkingSession, setCheckingSession] = useState(false);

  const pollRef = useRef(null);
  const activeUserIdRef = useRef(null);

  const sessionFailCountRef = useRef(0);

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

        if (hasActiveSub) {
          stopPremiumPolling();
        }
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
  // ✅ 1 DISPOSITIVO POR VEZ
  // =========================

  // cria/garante session_id + device_id e grava no banco (upsert)
  const registerSingleSession = useCallback(async (userId) => {
    if (!userId) return;

    setCheckingSession(true);

    try {
      // ✅ garante deviceId SEM loop de logout
      const deviceId = ensureDeviceId();

      let sid = getLocal(LOCAL_SESSION_KEY);
      if (!sid) {
        sid = generateId();
        setLocal(LOCAL_SESSION_KEY, sid);
      }

      const { error } = await supabase.from('user_sessions').upsert(
        {
          user_id: userId,
          session_id: sid,
          device_id: deviceId, // ✅ NOVO
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

  // verifica se o device atual ainda é o "dono" no banco
  const verifySingleSession = useCallback(
    async (userId) => {
      if (!userId) return true;

      try {
        const deviceId = ensureDeviceId(); // ✅ garante existir

        const { data, error } = await supabase
          .from('user_sessions')
          .select('device_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) throw error;

        // se não tem registro ainda, cria e deixa passar
        if (!data?.device_id) {
          await registerSingleSession(userId);
          return true;
        }

        // se for outro device -> bloqueia
        if (data.device_id !== deviceId) {
          return false;
        }

        // atualiza last_seen
        await supabase
          .from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', userId);

        return true;
      } catch (err) {
        console.error('Error verifying single session:', err);
        // em erro, não derruba (evita falso positivo)
        return true;
      }
    },
    [registerSingleSession]
  );

  const startSessionPolling = useCallback(
    async (userId) => {
      if (!userId) return;

      activeUserIdRef.current = userId;
      sessionFailCountRef.current = 0;

      // registra agora (isso cria deviceId também)
      await registerSingleSession(userId);

      stopSessionPolling();

      pollRef.current = setInterval(async () => {
        const currentUserId = activeUserIdRef.current;
        if (!currentUserId) return;

        const ok = await verifySingleSession(currentUserId);

        if (!ok) {
          sessionFailCountRef.current += 1;

          if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
            stopSessionPolling();

            // limpa ids locais
            setLocal(LOCAL_SESSION_KEY, '');
            setLocal(DEVICE_KEY, '');

            try {
              await supabase.auth.signOut();
            } catch {}
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

        if (currentUser) {
          // ✅ garante deviceId já no init (evita loop login->dashboard->logout)
          ensureDeviceId();

          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          setTimeout(() => {
            startSessionPolling(currentUser.id);
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

      const currentUser = session?.user ?? null;
      setSession(session ?? null);
      setUser(currentUser);

      if (currentUser) {
        activeUserIdRef.current = currentUser.id;

        // ✅ garante deviceId no momento do login
        ensureDeviceId();

        setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        setTimeout(() => startPremiumPolling(currentUser.id), 0);

        setTimeout(() => {
          startSessionPolling(currentUser.id);
        }, GRACE_AFTER_LOGIN_MS);
      } else {
        activeUserIdRef.current = null;
        stopSessionPolling();
        stopPremiumPolling();

        setLocal(LOCAL_SESSION_KEY, '');
        setLocal(DEVICE_KEY, '');

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
    startSessionPolling,
    stopSessionPolling,
    stopPremiumPolling,
  ]);

  // quando volta pra aba/janela, sincroniza premium
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
