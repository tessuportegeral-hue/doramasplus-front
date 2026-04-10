// src/hooks/useSessionGuard.js
// ============================================================
// Hook para validar sessão em qualquer componente (ex: player)
// Uso: coloque `useSessionGuard()` dentro do componente DoramaWatch
//
// Se a sessão for inválida (outro device entrou), força logout
// e redireciona pro login imediatamente.
// ============================================================

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const GUARD_POLL_MS = 8_000; // verifica a cada 8s enquanto está no player

const useSessionGuard = () => {
  const { user, isAuthenticated, kickedOut, clearKickedOut } = useAuth();
  const navigate = useNavigate();
  const pollRef = useRef(null);
  const realtimeRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Se kickedOut via contexto, redireciona
  useEffect(() => {
    if (kickedOut) {
      clearKickedOut();
      navigate("/login", { replace: true });
    }
  }, [kickedOut, clearKickedOut, navigate]);

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
      // Limpa versão local
      try { window.localStorage.removeItem(`dp_sv_${uid}`); } catch {}
      // Desloga e manda pro login com mensagem
      supabase.auth.signOut().finally(() => {
        if (isMountedRef.current) {
          navigate("/login?reason=other_device", { replace: true });
        }
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
  }, [isAuthenticated, user?.id, navigate]);
};

export default useSessionGuard;
