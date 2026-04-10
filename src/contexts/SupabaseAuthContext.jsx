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
// CONFIG
// =========================
const ENABLE_SINGLE_SESSION = true;
const SESSION_VERSION_KEY = (userId) => `dp_sv_${userId}`;
const SESSION_POLL_MS = 5_000;       // fallback polling a cada 5s
const GRACE_AFTER_LOGIN_MS = 3_000;  // grace após login

const PREMIUM_POLL_MS = 2500;
const PREMIUM_POLL_MAX_MS = 60_000;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const [isPremium, setIsPremium] = useState(false);
  const [checkingPremium, setCheckingPremium] = useState(true);
  const [checkingSession, setCheckingSession] = useState(false);

  // kickedOut: true quando este device foi derrubado por outro login
  const [kickedOut, setKickedOut] = useState(false);

  const pollRef = useRef(null);
  const realtimeChannelRef = useRef(null);
  const premiumPollRef = useRef(null);
  const premiumPollStartedAtRef = useRef(0);
  const isPremiumRef = useRef(false);
  const activeUserIdRef = useRef(null);
  const localVersionRef = useRef(null);
  const timersRef = useRef([]);
  const inFlightRef = useRef(false);
  const isKickedRef = useRef(false);

  // ========== HELPERS localStorage ==========
  const readStoredVersion = useCallback((userId) => {
    try { return window.localStorage.getItem(SESSION_VERSION_KEY(userId)) || null; } catch { return null; }
  }, []);

  const writeStoredVersion = useCallback((userId, version) => {
    try {
      if (version) window.localStorage.setItem(SESSION_VERSION_KEY(userId), version);
      else window.localStorage.removeItem(SESSION_VERSION_KEY(userId));
    } catch {}
  }, []);

  // ========== TIMERS ==========
  const clearTimers = useCallback(() => {
    (timersRef.current || []).forEach((t) => { try { clearTimeout(t); } catch {} });
    timersRef.current = [];
  }, []);

  // ========== PREMIUM ==========
  const stopPremiumPolling = useCallback(() => {
    if (premiumPollRef.current) { clearInterval(premiumPollRef.current); premiumPollRef.current = null; }
    premiumPollStartedAtRef.current = 0;
  }, []);

  const checkPremiumStatus = useCallback(async (userId) => {
    if (!userId) { setIsPremium(false); isPremiumRef.current = false; setCheckingPremium(false); return; }
    setCheckingPremium(true);
    try {
      const { data: subscriptions, error } = await supabase
        .from("subscriptions")
        .select("status, end_at, current_period_end, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) { console.error("Error checking premium:", error); return; }

      const subs = Array.isArray(subscriptions) ? subscriptions : [];
      if (subs.length === 0) { setIsPremium(!!isPremiumRef.current); return; }

      const now = new Date();
      const ACTIVE_STATUSES = new Set(["active", "trialing", "paid"]);
      const hasActiveSub = subs.some((sub) => {
        const status = String(sub?.status ?? "").trim().toLowerCase();
        if (!ACTIVE_STATUSES.has(status)) return false;
        const v = sub?.end_at || sub?.current_period_end;
        if (!v) return true;
        const d = new Date(v);
        return !Number.isNaN(d.getTime()) && d > now;
      });

      setIsPremium(hasActiveSub);
      isPremiumRef.current = hasActiveSub;
      if (hasActiveSub) stopPremiumPolling();
    } catch (err) {
      console.error("Error checking premium (fatal):", err);
    } finally {
      setCheckingPremium(false);
    }
  }, [stopPremiumPolling]);

  const startPremiumPolling = useCallback(async (userId) => {
    if (!userId) return;
    if (isPremiumRef.current) { stopPremiumPolling(); return; }
    if (premiumPollRef.current) return;

    premiumPollStartedAtRef.current = Date.now();
    await checkPremiumStatus(userId);
    if (isPremiumRef.current) { stopPremiumPolling(); return; }

    premiumPollRef.current = setInterval(async () => {
      const elapsed = Date.now() - (premiumPollStartedAtRef.current || 0);
      if (elapsed > PREMIUM_POLL_MAX_MS || isPremiumRef.current) { stopPremiumPolling(); return; }
      await checkPremiumStatus(userId);
    }, PREMIUM_POLL_MS);
  }, [checkPremiumStatus, stopPremiumPolling]);

  // ========== SINGLE SESSION ==========

  const stopSessionPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setCheckingSession(false);
  }, []);

  const stopRealtimeSession = useCallback(() => {
    if (realtimeChannelRef.current) {
      try { supabase.removeChannel(realtimeChannelRef.current); } catch {}
      realtimeChannelRef.current = null;
    }
  }, []);

  // ✅ FIX CRÍTICO: startSession NÃO sobrescreve se já tem UUID válido no banco
  // Isso evita o bug onde o device B derrubava a si mesmo após o grace period
  const startSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    const uid = activeUserIdRef.current;
    if (!uid || inFlightRef.current) return true;

    inFlightRef.current = true;
    setCheckingSession(true);
    try {
      // Verifica o que está no banco agora
      const { data: existing } = await supabase
        .from("active_sessions")
        .select("session_version")
        .eq("user_id", uid)
        .maybeSingle();

      const myVersion = localVersionRef.current || readStoredVersion(uid);

      // ✅ Se o banco já tem a nossa versão, não sobrescreve (evita kickar si mesmo)
      if (existing?.session_version && myVersion && existing.session_version === myVersion) {
        return true;
      }

      // ✅ Se o banco tem OUTRA versão e nós temos versão local,
      // significa que fomos kickados — não sobrescrevemos.
      // O validateSession vai detectar e derrubar.
      if (existing?.session_version && myVersion && existing.session_version !== myVersion) {
        return true;
      }

      // ✅ Só grava se não temos versão local (nunca deveria chegar aqui
      // em condições normais pois Login.jsx grava antes)
      if (!myVersion) {
        return true;
      }

      // Grava nossa versão (caso banco esteja vazio)
      const { error } = await supabase
        .from("active_sessions")
        .upsert(
          { user_id: uid, session_version: myVersion, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );

      if (error) { console.error("[single-session] startSession error:", error); return true; }

      return true;
    } catch (e) {
      console.error("[single-session] startSession exception:", e);
      return true;
    } finally {
      inFlightRef.current = false;
      setCheckingSession(false);
    }
  }, [readStoredVersion]);

  const validateSession = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION) return true;
    const uid = activeUserIdRef.current;
    if (!uid) return true;

    if (!localVersionRef.current) {
      const stored = readStoredVersion(uid);
      if (stored) {
        localVersionRef.current = stored;
      } else {
        // Sem versão local = ainda não gravou (logo após login), skip
        return true;
      }
    }

    try {
      const { data, error } = await supabase
        .from("active_sessions")
        .select("session_version")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) { console.error("[single-session] validateSession error:", error); return true; }
      if (!data) {
        // Sem registro no banco: grava a nossa versão
        await supabase
          .from("active_sessions")
          .upsert(
            { user_id: uid, session_version: localVersionRef.current, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        return true;
      }

      const bankVersion = String(data.session_version || "");
      const myVersion = String(localVersionRef.current || "");

      if (bankVersion !== myVersion) {
        console.warn("[single-session] versão diferente → kickando");
        return false;
      }
      return true;
    } catch (e) {
      console.error("[single-session] validateSession exception:", e);
      return true;
    }
  }, [readStoredVersion]);

  const forceSignOut = useCallback(async () => {
    if (isKickedRef.current) return;
    isKickedRef.current = true;

    stopSessionPolling();
    stopRealtimeSession();

    const uid = activeUserIdRef.current;
    localVersionRef.current = null;
    activeUserIdRef.current = null;
    if (uid) writeStoredVersion(uid, null);

    setKickedOut(true);
    try { await supabase.auth.signOut(); } catch (e) { console.error("[single-session] forceSignOut error:", e); }
  }, [stopSessionPolling, stopRealtimeSession, writeStoredVersion]);

  // ✅ REALTIME — escuta UPDATE na linha deste user_id
  const startRealtimeSession = useCallback((uid) => {
    if (!ENABLE_SINGLE_SESSION || !uid) return;
    stopRealtimeSession();

    const channel = supabase
      .channel(`session_watch_${uid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "active_sessions",
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          const newVersion = payload?.new?.session_version;
          const myV = localVersionRef.current;
          if (newVersion && myV && newVersion !== myV) {
            console.warn("[realtime] session_version mudou → kickando instantaneamente");
            forceSignOut();
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") console.log("[realtime] canal de sessão ativo");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[realtime] canal com problema — fallback polling cobre");
        }
      });

    realtimeChannelRef.current = channel;
  }, [stopRealtimeSession, forceSignOut]);

  // ✅ FIX: startSessionPolling NÃO chama startSession
  // Só inicia o monitoramento. O UUID já foi gravado pelo Login.jsx.
  const startSessionPolling = useCallback(async () => {
    if (!ENABLE_SINGLE_SESSION || !activeUserIdRef.current) return;

    stopSessionPolling();
    stopRealtimeSession();

    // Realtime — kick em < 1s
    startRealtimeSession(activeUserIdRef.current);

    // Primeira validação com pequeno delay pra dar tempo do Login.jsx gravar
    setTimeout(async () => {
      const ok = await validateSession();
      if (!ok) await forceSignOut();
    }, 1500);

    // Polling fallback — kick em até 5s se Realtime falhar
    pollRef.current = setInterval(async () => {
      const ok = await validateSession();
      if (!ok) await forceSignOut();
    }, SESSION_POLL_MS);
  }, [validateSession, forceSignOut, stopSessionPolling, stopRealtimeSession, startRealtimeSession]);

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
          setIsPremium(false); isPremiumRef.current = false;
          setCheckingPremium(false); setCheckingSession(false);
          activeUserIdRef.current = null; localVersionRef.current = null;
          isKickedRef.current = false;
          stopSessionPolling(); stopRealtimeSession(); stopPremiumPolling();
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

        stopSessionPolling(); stopRealtimeSession(); stopPremiumPolling();
        setIsPremium(false); isPremiumRef.current = false;
        setCheckingPremium(false); setCheckingSession(false);
      }

      setLoading(false);
    });

    return () => {
      isMounted = false;
      try { subscription.unsubscribe(); } catch {}
      clearTimers();
      stopSessionPolling();
      stopRealtimeSession();
      stopPremiumPolling();
    };
  }, [
    checkPremiumStatus, startPremiumPolling, startSessionPolling,
    stopSessionPolling, stopRealtimeSession, stopPremiumPolling,
    clearTimers, readStoredVersion, writeStoredVersion,
  ]);

  // ========== REVALIDAR AO VOLTAR PRA ABA ==========
  useEffect(() => {
    const onVisible = async () => {
      if (!activeUserIdRef.current) return;
      await checkPremiumStatus(activeUserIdRef.current);
      if (!isPremiumRef.current) startPremiumPolling(activeUserIdRef.current);

      if (ENABLE_SINGLE_SESSION) {
        const ok = await validateSession();
        if (!ok) await forceSignOut();
      }
    };

    const onFocus = () => onVisible();
    const onVisibility = () => { if (document.visibilityState === "visible") onVisible(); };

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

  const clearKickedOut = useCallback(() => {
    setKickedOut(false);
    isKickedRef.current = false;
  }, []);

  const value = {
    user, session, loading,
    isAuthenticated: !!user,
    isPremium, checkingPremium, refreshPremiumStatus,
    checkingSession, singleSessionEnabled: ENABLE_SINGLE_SESSION,
    kickedOut, clearKickedOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
