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

// ✅ (NOVO) device fixo por aparelho
const LOCAL_DEVICE_KEY = 'dp_device_id';

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

// ✅ cria um id robusto
const generateId = () => {
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

// ✅ (NOVO) device id local
const getLocalDeviceId = () => {
  try {
    return localStorage.getItem(LOCAL_DEVICE_KEY) || '';
  } catch {
    return '';
  }
};

const ensureLocalDeviceId = () => {
  try {
    let did = localStorage.getItem(LOCAL_DEVICE_KEY) || '';
    if (!did) {
      did = generateId();
      localStorage.setItem(LOCAL_DEVICE_KEY, did);
    }
    return did;
  } catch {
    // sem localStorage (raro) -> gera em memória
    return generateId();
  }
};

const isMissingColumnError = (err) => {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('column') && msg.includes('does not exist');
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);

  // ✅ estado da sessão única
  const [checkingSession, setCheckingSession] = useState(false);

  // refs pra controlar interval/estado sem bug de render
  const pollRef = useRef(null);
  const activeUserIdRef = useRef(null);

  // contador de falhas seguidas
  const sessionFailCountRef = useRef(0);

  // refs do sync premium
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);

  // ✅ (NOVO) cache: se o banco suporta device_id
  // null = ainda não sabemos; true/false depois de detectar
  const supportsDeviceIdRef = useRef(null);

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
  // ✅ 1 DISPOSITIVO / 1 SESSÃO (device_id + session_id)
  // =========================

  const registerSingleSession = useCallback(async (userId) => {
    if (!userId) return;

    setCheckingSession(true);

    try {
      // garante device id
      const device_id = ensureLocalDeviceId();

      // session id (permanece como você já tinha)
      let session_id = getLocalSessionId();
      if (!session_id) {
        session_id = generateId();
        setLocalSessionId(session_id);
      }

      const basePayload = {
        user_id: userId,
        session_id,
        updated_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      };

      // Se ainda não sabemos se existe device_id no banco, tenta com device_id 1x
      if (supportsDeviceIdRef.current !== false) {
        const { error } = await supabase.from('user_sessions').upsert(
          {
            ...basePayload,
            device_id,
          },
          { onConflict: 'user_id' }
        );

        if (!error) {
          supportsDeviceIdRef.current = true;
          return;
        }

        // Se falhou porque coluna não existe, cai pro modo antigo
        if (isMissingColumnError(error)) {
          supportsDeviceIdRef.current = false;

          const { error: err2 } = await supabase
            .from('user_sessions')
            .upsert(basePayload, { onConflict: 'user_id' });

          if (err2) throw err2;
          return;
        }

        // outro erro real
        throw error;
      }

      // modo antigo (sem device_id)
      const { error } = await supabase
        .from('user_sessions')
        .upsert(basePayload, { onConflict: 'user_id' });

      if (error) throw error;
    } catch (err) {
      console.error('Error registering single session:', err);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  const verifySingleSession = useCallback(
    async (userId) => {
      if (!userId) return true;

      try {
        const localSessionId = getLocalSessionId();
        const localDeviceId = getLocalDeviceId();

        // Se não tem session local, registra e segue
        if (!localSessionId) {
          await registerSingleSession(userId);
          return true;
        }

        // Se não tem device local (apagaram storage), recria e registra
        if (!localDeviceId) {
          ensureLocalDeviceId();
          await registerSingleSession(userId);
          return true;
        }

        // tenta buscar device_id também (se existir)
        let selectStr = 'session_id';
        if (supportsDeviceIdRef.current !== false) selectStr = 'session_id,device_id';

        const { data, error } = await supabase
          .from('user_sessions')
          .select(selectStr)
          .eq('user_id', userId)
          .maybeSingle();

        if (error) {
          // se foi erro de coluna device_id inexistente, desliga suporte e tenta de novo
          if (isMissingColumnError(error)) {
            supportsDeviceIdRef.current = false;

            const { data: d2, error: e2 } = await supabase
              .from('user_sessions')
              .select('session_id')
              .eq('user_id', userId)
              .maybeSingle();

            if (e2) throw e2;

            if (!d2?.session_id) {
              await registerSingleSession(userId);
              return true;
            }

            if (d2.session_id !== localSessionId) return false;

            await supabase
              .from('user_sessions')
              .update({ last_seen: new Date().toISOString() })
              .eq('user_id', userId);

            return true;
          }

          throw error;
        }

        // se não existe registro, registra e segue
        if (!data) {
          await registerSingleSession(userId);
          return true;
        }

        // ✅ Se o banco tem device_id, o “dono” é o device
        if (supportsDeviceIdRef.current === true && data.device_id) {
          if (String(data.device_id) !== String(localDeviceId)) {
            return false; // outro aparelho tomou
          }

          // opcional: também valida session_id (extra)
          if (data.session_id && String(data.session_id) !== String(localSessionId)) {
            // aqui você pode decidir se derruba ou só ignora.
            // Vou manter derrubando pra ficar “1 sessão por vez” mesmo.
            return false;
          }

          await supabase
            .from('user_sessions')
            .update({ last_seen: new Date().toISOString() })
            .eq('user_id', userId);

          return true;
        }

        // ✅ Modo antigo: compara session_id
        if (!data.session_id) {
          await registerSingleSession(userId);
          return true;
        }

        if (String(data.session_id) !== String(localSessionId)) {
          return false;
        }

        await supabase
          .from('user_sessions')
          .update({ last_seen: new Date().toISOString() })
          .eq('user_id', userId);

        return true;
      } catch (err) {
        console.error('Error verifying single session:', err);
        // em erro: NÃO derruba (evita falso positivo)
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

      // registra agora
      await registerSingleSession(userId);

      // evita múltiplos intervals
      stopSessionPolling();

      pollRef.current = setInterval(async () => {
        const currentUserId = activeUserIdRef.current;
        if (!currentUserId) return;

        const ok = await verifySingleSession(currentUserId);

        if (!ok) {
          sessionFailCountRef.current += 1;

          // só derruba se falhar 2x seguidas
          if (sessionFailCountRef.current >= FAIL_THRESHOLD) {
            stopSessionPolling();
            setLocalSessionId('');

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
          // garante device_id existindo local (pra não dar “vazio”)
          ensureLocalDeviceId();

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

        // garante device
        ensureLocalDeviceId();

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

  // ✅ quando usuário volta pra aba/janela, sincroniza premium (útil pro Pix)
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
