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

// ✅ tempo de verificação (ms) — ajustado para 5s
const SESSION_POLL_MS = 5000;

// ✅ (novo) só derruba se falhar X vezes seguidas (evita falso positivo)
const FAIL_THRESHOLD = 2;

// ✅ (novo) tempo de “graça” após login/refresh de sessão (ms)
const GRACE_AFTER_LOGIN_MS = 1500;

// ✅ (novo) tempo de sync do premium (ms)
const PREMIUM_POLL_MS = 2500;

// ✅ (novo) por quanto tempo tentar sincronizar premium após login/checkout (ms)
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

// ✅ (NOVO) testa se o localStorage está persistindo de verdade
const canPersistLocalSessionId = () => {
  try {
    const testKey = `${LOCAL_SESSION_KEY}__test`;
    localStorage.setItem(testKey, '1');
    const ok = localStorage.getItem(testKey) === '1';
    localStorage.removeItem(testKey);
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

  // refs pra controlar interval/estado sem bug de render
  const pollRef = useRef(null);
  const activeUserIdRef = useRef(null);

  // ✅ (novo) contador de falhas seguidas (pra evitar derrubar por lag)
  const sessionFailCountRef = useRef(0);

  // ✅ (novo) refs do sync premium
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

  // ✅ (novo) para o sync premium
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

        // ✅ se virou premium, para o polling automático
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

  // ✅ (novo) começa um “auto-sync” do premium por um tempo (resolve Pix liberar na hora)
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
  // ✅ 1 SESSÃO POR VEZ (SESSION_ID)
  // =========================

  // cria/garante session_id local + grava no banco (upsert)
  const registerSingleSession = useCallback(async (userId) => {
    if (!userId) return;

    try {
      // ✅ se localStorage não é confiável nesse navegador, NÃO aplica regra
      if (!canPersistLocalSessionId()) return;

      let sid = getLocalSessionId();
      if (!sid) {
        sid = generateSessionId();
        setLocalSessionId(sid);

        // ✅ garante que persistiu de verdade
        const saved = getLocalSessionId();
        if (saved !== sid) return; // não persistiu -> não aplica regra
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
    }
  }, []);

  // verifica se a sessão local ainda é a "dona" no banco
  const verifySingleSession = useCallback(
    async (userId) => {
      if (!userId) return true;

      try {
        // ✅ se localStorage não é confiável nesse navegador, NÃO aplica regra
        if (!canPersistLocalSessionId()) return true;

        const sid = getLocalSessionId();
        // sid vazio/curto = não confiável -> não aplica regra
        if (!sid || sid.length < 10) return true;

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

        await supabase
          .from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', userId);

        return true;
      } catch (err) {
        console.error('Error verifying single session:', err);
        return true; // em erro, não derruba
      }
    },
    [registerSingleSession]
  );

  const startSessionPolling = useCallback(
    async (userId) => {
      if (!userId) return;

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

          if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
            // ✅ MUDANÇA CRÍTICA: NÃO derruba mais (pra voltar online agora)
            // Só para o polling pra não ficar batendo.
            stopSessionPolling();
            console.warn('[single-session] detectou outra sessão, polling parado (sem logout).');
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
            startSessionPolling(currentUser.id);
          }, GRACE_AFTER_LOGIN_MS);
        } else {
          setIsPremium(false);
          isPremiumRef.current = false;
          setCheckingPremium(false);
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

        setTimeout(() => {
          checkPremiumStatus(currentUser.id);
        }, 0);

        setTimeout(() => {
          startPremiumPolling(currentUser.id);
        }, 0);

        setTimeout(() => {
          startSessionPolling(currentUser.id);
        }, GRACE_AFTER_LOGIN_MS);
      } else {
        activeUserIdRef.current = null;
        stopSessionPolling();
        stopPremiumPolling();
        setLocalSessionId('');
        setIsPremium(false);
        isPremiumRef.current = false;
        setCheckingPremium(false);
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
