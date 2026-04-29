import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const GUARD_POLL_MS = 8_000;

const stopAllMedia = () => {
  document.querySelectorAll("iframe").forEach((el) => {
    try { el.contentWindow?.postMessage(JSON.stringify({ event: "pause" }), "*"); } catch {}
    try { el.src = "about:blank"; } catch {}
    try { el.remove(); } catch {}
  });
  document.querySelectorAll("video, audio").forEach((el) => {
    try { el.pause(); el.src = ""; } catch {}
  });
};

const useSessionGuard = () => {
  const { user, isAuthenticated, kickedOut, clearKickedOut } = useAuth();
  const pollRef = useRef(null);
  const realtimeRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (kickedOut) {
      clearKickedOut();
      stopAllMedia();
      window.location.href = "/login?reason=other_device";
    }
  }, [kickedOut, clearKickedOut]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      // Limpa tudo se deslogou
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (realtimeRef.current) {
        try { supabase.removeChannel(realtimeRef.current); } catch {}
        realtimeRef.current = null;
      }
      return;
    }

    const uid = user.id;

    const getMyVersion = () => {
      try { return window.localStorage.getItem(`dp_sv_${uid}`) || null; } catch { return null; }
    };

    const handleKick = () => {
      if (!isMountedRef.current) return;
      // Para o polling antes de deslogar
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (realtimeRef.current) {
        try { supabase.removeChannel(realtimeRef.current); } catch {}
        realtimeRef.current = null;
      }
      try { window.localStorage.removeItem(`dp_sv_${uid}`); } catch {}
      stopAllMedia();
      supabase.auth.signOut().finally(() => {
        window.location.href = "/login?reason=other_device";
      });
    };

    const validate = async () => {
      if (!isMountedRef.current) return;
      const myVersion = getMyVersion();
      if (!myVersion) return; // ainda não tem versão, aguarda

      try {
        const { data, error } = await supabase
          .from("active_sessions")
          .select("session_version")
          .eq("user_id", uid)
          .maybeSingle();

        if (!isMountedRef.current) return;
        if (error) return; // fail-open
        if (!data) return; // sem registro, aguarda

        const bankVersion = String(data.session_version || "");
        const localVersion = String(myVersion || "");

        if (bankVersion !== localVersion) {
          console.warn("[useSessionGuard] sessão inválida no player → kickando");
          handleKick();
        }
      } catch {
        // fail-open
      }
    };

    // ✅ Realtime: detecta mudança imediata (kick em < 1s)
    const channel = supabase
      .channel(`guard_${uid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "active_sessions",
          filter: `user_id=eq.${uid}`,
        },
        (payload) => {
          if (!isMountedRef.current) return;
          const newVersion = payload?.new?.session_version;
          const myV = getMyVersion();
          if (newVersion && myV && newVersion !== myV) {
            console.warn("[useSessionGuard] Realtime detectou sessão inválida → kickando");
            handleKick();
          }
        }
      )
      .subscribe();

    realtimeRef.current = channel;

    // ✅ Polling fallback (caso Realtime falhe)
    validate(); // verifica imediatamente ao montar
    pollRef.current = setInterval(validate, GUARD_POLL_MS);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (realtimeRef.current) {
        try { supabase.removeChannel(realtimeRef.current); } catch {}
        realtimeRef.current = null;
      }
    };
  }, [isAuthenticated, user?.id]);
};

export default useSessionGuard;
