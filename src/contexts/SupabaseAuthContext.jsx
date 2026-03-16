// src/contexts/SupabaseAuthContext.jsx
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

// ✅ ATIVADO — single session (1 dispositivo por vez)
const ENABLE_SINGLE_SESSION = true;

// ✅ Chave do localStorage (compartilhada entre abas do mesmo device)
const SESSION_VERSION_KEY = (userId) => `dp_sv_${userId}`;

// ✅ Polling a cada 15s (leve)
const SESSION_POLL_MS = 15_000;

// ✅ Grace após login (ms) — evita derrubar na hora
const GRACE_AFTER_LOGIN_MS = 3_000;

// ✅ Quantas falhas seguidas antes de deslogar
const INVALID_STREAK_LIMIT = 3;

// ✅ premium
const PREMIUM_POLL_MS = 2500;
const PREMIUM_POLL_MAX_MS = 60_000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);
  const [checkingSession, setCheckingSession] = useState(false);

  // refs internos
  const pollRef = useRef(null);
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);
  const activeUserIdRef = useRef(null);
  const localVersionRef = useRef(null); // versão que este dispositivo tem
  const invalidStreakRef = useRef(0);
  const timersRef = useRef([]);
  const inFlightRef = useRef(false);

  // ========== HELPERS localStorage ==========
  const readStoredVersion = useCallback((userId) => {
    try {
      return window.localStorage.getItem(SESSION_VERSION_KEY(userId)) || null;
    } catch {
      return null;
    }
  }, []);

  const writeStoredVersion = useCallback((userId, version) => {
    try {
      if (version) {
        window.localStorage.setItem(SESSION_VERSION_KEY(userId), version);
      } else {
        window.localStorage.removeItem(SESSION_VERSION_KEY(userId));
      }
    } catch {}
  }, []);

  // ========== TIMERS ==========
  const clearTimers = useCallback(() => {
    (timersRef.current || []).forEach((t) => { try { clearTimeout(t); } catch {} });
    timersRef.current = [];
  }, []);

  // ========== PREMIUM ==========
  const stopPremiumPolling = useCallback(() => {
    if (premiumPollRef.current) {
      clearInterval(premiumPollRef.current);
      premiumPollRef.current = null;
    }
    premiumPollStartedAtRef.current = 0;
  }, []);

  const checkPremiumStatus = useCallback(async (userId) => {
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
        .select("status, end_at, current_period_end, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) {
        console.error("Error checking premium status:", error);
        return;
      }

      const subs = Array.isArray(subscriptions) ? subscriptions : [];

      if (subs.length === 0) {
        const keep = !!isPremiumRef.current;
        setIsPremium(keep);
        return;
      }

      const now = new Date();
      const ACTIVE_STATUSES = new Set(["active", "trialing", "paid"]);

      const hasActiveSub = subs.some((sub) => {
        const status = String(sub?.status ?? "").trim().toLowerCase();
        if (!ACTIVE_STATUSES.has(status)) return false;

        const endDate = (() => {
          const v = sub?.end_at || sub?.current_period_end;
          if (!v) return null;
          const d = new Date(v);
          return Number.isNaN(d.getTime()) ? null : d;
        })();

        if (endDate) return endDate > now;
        return true;
      });

      setIsPremium(hasActiveSub);
      isPremiumRef.current = hasActiveSub;

      if (hasActiveSub) stopPremiumPolling();
    } catch (err) {
      console.error("Error checking premium status (fatal):", err);
    } finally {
      setCheckingPremium(false);
    }
  }, [stopPremiumPolling]);

  const startPremiumPolling = useCallback(async (userId) => {
    if (!userId) return;
    if (isPremiumRef.current === true) { stopPremiumPolling(); return; }
    if (premiumPollRef.current) return;

    premiumPollStartedAtRef.current = Date.now();
    await checkPremiumStatus(userId);

    if (isPremiumRef.current === true) { stopPremiumPolling(); return; }

    premiumPollRef.current = setInterval(async () => {
      const elapsed = Date.now() - (premiumPollStartedAtRef.current || 0);
      if (elapsed > PREMIUM_POLL_MAX_MS) { stopPremiumPolling(); return; }
      if (isPremiumRef.current === true) { stopPremiumPolling(); return; }
      await checkPremiumStatus(userId);
    }, PREMIUM_POLL_MS);
  }, [checkPremiumStatus, stopPremiumPolling]);

  // ========== SINGLE SESSION (direto no banco) ==========

  const stopSessionPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setCheckingSession(false);
  }, []);

  /**
   * Registra/atualiza a sessão deste dispositivo no banco.
   * Gera um novo UUID e salva em active_sessions + localStorage.
   */
  const startSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    const uid = activeUserIdRef.current;
    if (!uid) return true;
    if (inFlightRef.current) return true;

    inFlightRef.current = true;
    setCheckingSession(true);

    try {
      const newVersion = crypto.randomUUID();

      const { error } = await supabase
        .from("active_sessions")
        .upsert(
          {
            user_id: uid,
            session_version: newVersion,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) {
        console.error("[single-session] startSession error:", error);
        return true; // fail-open
      }

      localVersionRef.current = newVersion;
      writeStoredVersion(uid, newVersion);
      invalidStreakRef.current = 0;
      return true;
    } catch (e) {
      console.error("[single-session] startSession exception:", e);
      return true;
    } finally {
      inFlightRef.current = false;
      setCheckingSession(false);
    }
  }, [writeStoredVersion]);

  /**
   * Valida se a versão no banco ainda bate com a local.
   * Se não bater → outro dispositivo logou → derruba.
   */
  const validateSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    const uid = activeUserIdRef.current;
    if (!uid) return true;

    // Se não temos versão local, tenta carregar do localStorage
    if (!localVersionRef.current) {
      const stored = readStoredVersion(uid);
      if (stored) {
        localVersionRef.current = stored;
      } else {
        // Sem versão local: registra agora
        await startSession();
        return true;
      }
    }

    try {
      const { data, error } = await supabase
        .from("active_sessions")
        .select("session_version")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) {
        console.error("[single-session] validateSession error:", error);
        return true; // fail-open (não derruba por erro de rede)
      }

      if (!data) {
        // Nenhuma sessão no banco → registra este dispositivo
        await startSession();
        return true;
      }

      const bankVersion = String(data.session_version || "");
      const myVersion = String(localVersionRef.current || "");

      if (bankVersion !== myVersion) {
        console.warn("[single-session] versão diferente → outro dispositivo logou");
        return false; // derruba
      }

      invalidStreakRef.current = 0;
      return true;
    } catch (e) {
      console.error("[single-session] validateSession exception:", e);
      return true; // fail-open
    }
  }, [readStoredVersion, startSession]);

  const forceSignOut = useCallback(async () => {
    try {
      stopSessionPolling();
      const uid = activeUserIdRef.current;
      localVersionRef.current = null;
      activeUserIdRef.current = null;
      invalidStreakRef.current = 0;
      if (uid) writeStoredVersion(uid, null);
      await supabase.auth.signOut();
    } catch (e) {
      console.error("[single-session] forceSignOut error:", e);
    }
  }, [stopSessionPolling, writeStoredVersion]);

  const startSessionPolling = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return;
    if (!activeUserIdRef.current) return;

    stopSessionPolling();

    // Registra este dispositivo
    await startSession();

    pollRef.current = setInterval(async () => {
      const ok = await validateSession();

      if (!ok) {
        invalidStreakRef.current = (invalidStreakRef.current || 0) + 1;
        if (invalidStreakRef.current >= INVALID_STREAK_LIMIT) {
          await forceSignOut();
        }
        return;
      }

      invalidStreakRef.current = 0;
    }, SESSION_POLL_MS);
  }, [startSession, validateSession, forceSignOut, stopSessionPolling]);

  // ========== INIT + AUTH LISTENER ==========
  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      try {
        setLoading(true);
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) console.error("Error getting initial session:", error);
        if (!isMounted) return;

        setSession(session ?? null);
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        clearTimers();

        if (currentUser) {
          activeUserIdRef.current = currentUser.id;
          invalidStreakRef.current = 0;

          // Carrega versão do localStorage (para o caso de reload)
          const stored = readStoredVersion(currentUser.id);
          localVersionRef.current = stored || null;

          checkPremiumStatus(currentUser.id);
          startPremiumPolling(currentUser.id);

          const t = setTimeout(() => startSessionPolling(), GRACE_AFTER_LOGIN_MS);
          timersRef.current.push(t);
        } else {
          setIsPremium(false);
          isPremiumRef.current = false;
          setCheckingPremium(false);
          setCheckingSession(false);
          activeUserIdRef.current = null;
          localVersionRef.current = null;
          invalidStreakRef.current = 0;
          stopSessionPolling();
          stopPremiumPolling();
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      const currentUser = session?.user ?? null;
      setSession(session ?? null);
      setUser(currentUser);
      clearTimers();

      if (currentUser) {
        activeUserIdRef.current = currentUser.id;
        invalidStreakRef.current = 0;

        const stored = readStoredVersion(currentUser.id);
        localVersionRef.current = stored || null;

        const t1 = setTimeout(() => checkPremiumStatus(currentUser.id), 0);
        const t2 = setTimeout(() => startPremiumPolling(currentUser.id), 0);
        const t3 = setTimeout(() => startSessionPolling(), GRACE_AFTER_LOGIN_MS);
        timersRef.current.push(t1, t2, t3);
      } else {
        const uid = activeUserIdRef.current;
        activeUserIdRef.current = null;
        localVersionRef.current = null;
        invalidStreakRef.current = 0;
        if (uid) writeStoredVersion(uid, null);

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
      try { subscription.unsubscribe(); } catch {}
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
    readStoredVersion,
    writeStoredVersion,
  ]);

  // ========== REVALIDAR AO VOLTAR PARA A ABA ==========
  useEffect(() => {
    const onFocus = async () => {
      if (!activeUserIdRef.current) return;
      await checkPremiumStatus(activeUserIdRef.current);
      if (!isPremiumRef.current) startPremiumPolling(activeUserIdRef.current);

      // Ao retornar à aba, zera streak mas não reassume (não briga com o device atual)
      invalidStreakRef.current = 0;
    };

    const onVisibility = async () => {
      if (document.visibilityState === "visible") await onFocus();
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
  }, [checkPremiumStatus, startPremiumPolling]);

  const refreshPremiumStatus = useCallback(() => {
    if (user) {
      checkPremiumStatus(user.id);
      if (!isPremiumRef.current) startPremiumPolling(user.id);
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
