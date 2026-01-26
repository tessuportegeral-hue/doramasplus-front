// src/contexts/SupabaseAuthContext.jsx (ou onde estiver o seu AuthProvider)
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
// ❗ (EDITADO) DESLIGADO temporariamente pra não quebrar checkout/pix (erro user_sessions.device_id)
const ENABLE_SINGLE_SESSION = false;

// ✅ Edge Functions (nomes que você criou no Supabase)
const START_SESSION_FN = "start-session";
const VALIDATE_SESSION_FN = "validate-session";

// ✅ tempo de verificação (ms) — mais leve pra não derrubar por falso positivo
const SESSION_POLL_MS = 12_000;

// ✅ grace após login/refresh (ms) — mais folga
const GRACE_AFTER_LOGIN_MS = 2_500;

// ✅ premium
const PREMIUM_POLL_MS = 2500;
const PREMIUM_POLL_MAX_MS = 60_000;

// ✅ Quantas falhas seguidas antes de derrubar
const INVALID_STREAK_LIMIT = 3;

// ✅ chave de localStorage para compartilhar session_version entre abas
const getSessionStorageKey = (userId) => `dp_session_version_${userId || "anon"}`;

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

  // ✅ controle de falso positivo: só derruba se falhar várias vezes seguidas
  const invalidStreakRef = useRef(0);

  // ✅ helpers localStorage (seguro p/ Safari)
  const readStoredSessionVersion = useCallback((userId) => {
    try {
      if (typeof window === "undefined") return null;
      const key = getSessionStorageKey(userId);
      const v = window.localStorage.getItem(key);
      return v ? String(v) : null;
    } catch {
      return null;
    }
  }, []);

  const writeStoredSessionVersion = useCallback((userId, version) => {
    try {
      if (typeof window === "undefined") return;
      const key = getSessionStorageKey(userId);
      if (!version) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, String(version));
      }
    } catch {}
  }, []);

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
  // PREMIUM ✅ (PATCH FAIL-OPEN: NÃO DERRUBA ATIVO PRA /plans)
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
        // ✅ NÃO filtra status aqui (porque pode vir "Active", "paid", etc)
        // ✅ (FIX) NÃO pede colunas que não existem (isso estava dando 400 e derrubando geral)
        const { data: subscriptions, error } = await supabase
          .from("subscriptions")
          .select("status, end_at, current_period_end, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(5);

        // ✅ (PATCH) se der erro, NÃO derruba forçando false
        if (error) {
          console.error("Error checking premium status (query):", error);
          return;
        }

        const subs = Array.isArray(subscriptions) ? subscriptions : [];

        // ✅ (PATCH CRÍTICO) Se veio vazio, NÃO conclui "não premium".
        // Mantém o estado atual (só mantém true se já era true).
        if (subs.length === 0) {
          const keep = !!isPremiumRef.current;
          console.warn("[premium] subscriptions vazio — mantendo estado atual:", keep);
          setIsPremium(keep);
          return;
        }

        const now = new Date();

        const normalizeStatus = (s) => String(s ?? "").trim().toLowerCase();

        const parseDateSafe = (v) => {
          if (!v) return null;
          const d = new Date(v);
          if (Number.isNaN(d.getTime())) return null;
          return d;
        };

        // ✅ considera “premium” se:
        // - status é active/trialing/paid (qualquer capitalização)
        // - e (data final é futura OU não existe data final)
        const ACTIVE_STATUSES = new Set(["active", "trialing", "paid"]);

        const hasActiveSub = subs.some((sub) => {
          const status = normalizeStatus(sub?.status);
          if (!ACTIVE_STATUSES.has(status)) return false;

          const endDate =
            parseDateSafe(sub?.end_at) ||
            parseDateSafe(sub?.current_period_end) ||
            null;

          // ✅ se tem data, precisa ser futura
          if (endDate) return endDate > now;

          // ✅ se NÃO tem data mas status está ativo, libera
          return true;
        });

        setIsPremium(hasActiveSub);
        isPremiumRef.current = hasActiveSub;

        if (hasActiveSub) stopPremiumPolling();
      } catch (err) {
        console.error("Error checking premium status (fatal):", err);
        // ✅ não força false aqui
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

  // ✅ agora reutiliza session_version do localStorage entre abas
  const startSingleSession = useCallback(
    async (opts = {}) => {
      const force = !!opts.force;

      if (!ENABLE_SINGLE_SESSION) return true;
      const uid = activeUserIdRef.current;
      if (!uid) return true;

      // ✅ se já tem versão salva e não é force, usa ela e NÃO chama start-session de novo
      if (!force) {
        const stored = readStoredSessionVersion(uid);
        if (stored) {
          sessionVersionRef.current = stored;
          invalidStreakRef.current = 0;
          return true;
        }
      }

      if (startInFlightRef.current) return true;
      startInFlightRef.current = true;

      setCheckingSession(true);

      try {
        const { data, error } = await supabase.functions.invoke(START_SESSION_FN, {
          body: {
            force,
            user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          },
        });

        if (error) throw error;

        const v =
          data?.session_version ||
          data?.sessionVersion ||
          data?.session ||
          data?.version ||
          null;

        if (!v) {
          console.warn("[start-session] resposta sem session_version:", data);
          sessionVersionRef.current = null;
          return true;
        }

        sessionVersionRef.current = String(v);
        writeStoredSessionVersion(uid, sessionVersionRef.current);

        invalidStreakRef.current = 0;
        return true;
      } catch (e) {
        console.error("Error startSingleSession:", e);
        sessionVersionRef.current = null;
        return true;
      } finally {
        startInFlightRef.current = false;
        setCheckingSession(false);
      }
    },
    [readStoredSessionVersion, writeStoredSessionVersion]
  );

  const validateSingleSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    const uid = activeUserIdRef.current;
    if (!uid) return true;

    // ✅ se ref tá vazia, tenta puxar do localStorage antes de qualquer coisa
    if (!sessionVersionRef.current) {
      const stored = readStoredSessionVersion(uid);
      if (stored) sessionVersionRef.current = stored;
    }

    // se ainda não temos version, tenta iniciar (sem punir se não vier)
    if (!sessionVersionRef.current) {
      await startSingleSession();
      if (!sessionVersionRef.current) return true;
    }

    if (validateInFlightRef.current) return true;
    validateInFlightRef.current = true;

    try {
      const { data, error } = await supabase.functions.invoke(VALIDATE_SESSION_FN, {
        body: { session_version: sessionVersionRef.current },
      });

      if (error) throw error;

      const valid =
        data?.valid ??
        data?.is_valid ??
        data?.ok ??
        (data?.status ? data.status === "ok" : undefined);

      if (typeof valid !== "boolean") {
        console.warn("[validate-session] resposta inesperada:", data);
        return true;
      }

      // ✅ se vier inválido, tenta reassumir 1x antes de considerar falha real
      if (valid === false) {
        await startSingleSession({ force: true });

        if (!sessionVersionRef.current) return true;

        const { data: data2, error: error2 } = await supabase.functions.invoke(
          VALIDATE_SESSION_FN,
          { body: { session_version: sessionVersionRef.current } }
        );

        if (error2) return true;

        const valid2 =
          data2?.valid ??
          data2?.is_valid ??
          data2?.ok ??
          (data2?.status ? data2.status === "ok" : undefined);

        if (typeof valid2 !== "boolean") return true;

        return valid2;
      }

      return true;
    } catch (e) {
      console.error("Error validateSingleSession:", e);
      return true;
    } finally {
      validateInFlightRef.current = false;
    }
  }, [readStoredSessionVersion, startSingleSession]);

  const forceSignOut = useCallback(async () => {
    try {
      stopSessionPolling();

      const uid = activeUserIdRef.current;

      sessionVersionRef.current = null;
      activeUserIdRef.current = null;
      invalidStreakRef.current = 0;

      // ✅ limpa o cache compartilhado também
      if (uid) writeStoredSessionVersion(uid, null);

      await supabase.auth.signOut();
    } catch (e) {
      console.error("Error signOut:", e);
    }
  }, [stopSessionPolling, writeStoredSessionVersion]);

  const startSessionPolling = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return;
    if (!activeUserIdRef.current) return;

    stopSessionPolling();

    // ✅ tenta usar a versão compartilhada, só chama start-session se precisar
    await startSingleSession();

    pollRef.current = setInterval(async () => {
      const ok = await validateSingleSession();

      if (!ok) {
        invalidStreakRef.current = (invalidStreakRef.current || 0) + 1;

        if (invalidStreakRef.current >= INVALID_STREAK_LIMIT) {
          await forceSignOut();
        }
        return;
      }

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

          // ✅ carrega session_version compartilhado ao iniciar
          const stored = readStoredSessionVersion(currentUser.id);
          sessionVersionRef.current = stored || null;

          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

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

        // ✅ carrega session_version compartilhado ao logar/voltar
        const stored = readStoredSessionVersion(currentUser.id);
        sessionVersionRef.current = stored || null;

        const t1 = setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        const t2 = setTimeout(() => startPremiumPolling(currentUser.id), 0);

        const t3 = setTimeout(() => startSessionPolling(), GRACE_AFTER_LOGIN_MS);

        timersRef.current.push(t1, t2, t3);
      } else {
        const uid = activeUserIdRef.current;

        activeUserIdRef.current = null;
        sessionVersionRef.current = null;
        invalidStreakRef.current = 0;

        if (uid) writeStoredSessionVersion(uid, null);

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
    readStoredSessionVersion,
    writeStoredSessionVersion,
  ]);

  // ✅ quando usuário volta pra aba/janela:
  // NÃO derruba mais: só reassume e zera streak
  useEffect(() => {
    const onFocus = async () => {
      if (!activeUserIdRef.current) return;

      await checkPremiumStatus(activeUserIdRef.current);
      if (isPremiumRef.current === false) startPremiumPolling(activeUserIdRef.current);

      // ✅ reassume só se precisar (usa localStorage primeiro)
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

    singleSessionEnabled: ENABLE_SINGLE_SESSION,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
