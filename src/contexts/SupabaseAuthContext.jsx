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

const ENABLE_SINGLE_SESSION = true;

const SESSION_VERSION_KEY = (userId) => `dp_sv_${userId}`;

// Polling normal a cada 5s (era 15s — mais rápido pra detectar kick)
const SESSION_POLL_MS = 5_000;

// Grace após login
const GRACE_AFTER_LOGIN_MS = 3_000;

// ✅ Removido INVALID_STREAK_LIMIT — agora derruba na PRIMEIRA detecção

const PREMIUM_POLL_MS = 2500;
const PREMIUM_POLL_MAX_MS = 60_000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);
  const [checkingSession, setCheckingSession] = useState(false);

  // ✅ NOVO — estado para mostrar modal/tela de "você foi desconectado"
  const [kickedOut, setKickedOut] = useState(false);

  const pollRef = useRef(null);
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);
  const activeUserIdRef = useRef(null);
  const localVersionRef = useRef(null);
  const timersRef = useRef([]);
  const inFlightRef = useRef(false);
  const isKickedRef = useRef(false); // evita múltiplos forceSignOut simultâneos

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

  // ========== SINGLE SESSION ==========

  const stopSessionPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setCheckingSession(false);
  }, []);

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
        return true;
      }

      localVersionRef.current = newVersion;
      writeStoredVersion(uid, newVersion);
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
   * ✅ CORRIGIDO — derruba na PRIMEIRA detecção, sem esperar streak
   */
  const validateSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    const uid = activeUserIdRef.current;
    if (!uid) return true;

    if (!localVersionRef.current) {
      const stored = readStoredVersion(uid);
      if (stored) {
        localVersionRef.current = stored;
      } else {
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
        return true; // fail-open
      }

      if (!data) {
        await startSession();
        return true;
      }

      const bankVersion = String(data.session_version || "");
      const myVersion = String(localVersionRef.current || "");

      if (bankVersion !== myVersion) {
        console.warn("[single-session] versão diferente → outro dispositivo logou → deslogando agora");
        return false; // ✅ derruba imediatamente
      }

      return true;
    } catch (e) {
      console.error("[single-session] validateSession exception:", e);
      return true;
    }
  }, [readStoredVersion, startSession]);

  /**
   * ✅ CORRIGIDO — seta kickedOut=true antes de deslogar,
   * assim o app pode mostrar tela/modal explicando o motivo
   */
  const forceSignOut = useCallback(async () => {
    if (isKickedRef.current) return; // evita duplo disparo
    isKickedRef.current = true;

    try {
      stopSessionPolling();
      const uid = activeUserIdRef.current;
      localVersionRef.current = null;
      activeUserIdRef.current = null;
      if (uid) writeStoredVersion(uid, null);

      // ✅ Avisa a UI ANTES de deslogar
      setKickedOut(true);

      await supabase.auth.signOut();
    } catch (e) {
      console.error("[single-session] forceSignOut error:", e);
    }
  }, [stopSessionPolling, writeStoredVersion]);

  const startSessionPolling = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return;
    if (!activeUserIdRef.current) return;

    stopSessionPolling();
    await startSession();

    pollRef.current = setInterval(async () => {
      const ok = await validateSession();

      if (!ok) {
        // ✅ Derruba na primeira falha — sem streak
        await forceSignOut();
      }
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
          isKickedRef.current = false;

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
          isKickedRef.current = false;
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
        isKickedRef.current = false;
        // ✅ Novo login → limpa kickedOut
        setKickedOut(false);

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

      // ✅ Ao voltar pra aba, valida sessão imediatamente (não espera o próximo poll)
      if (ENABLE_SINGLE_SESSION) {
        const ok = await validateSession();
        if (!ok) await forceSignOut();
      }
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
  }, [checkPremiumStatus, startPremiumPolling, validateSession, forceSignOut]);

  const refreshPremiumStatus = useCallback(() => {
    if (user) {
      checkPremiumStatus(user.id);
      if (!isPremiumRef.current) startPremiumPolling(user.id);
    }
  }, [user, checkPremiumStatus, startPremiumPolling]);

  // ✅ Limpa kickedOut quando usuário faz login novo
  const clearKickedOut = useCallback(() => {
    setKickedOut(false);
    isKickedRef.current = false;
  }, []);

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
    // ✅ NOVO — exposto pra tela de login/app poder reagir
    kickedOut,
    clearKickedOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
