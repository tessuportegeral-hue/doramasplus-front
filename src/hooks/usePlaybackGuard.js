import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getDeviceId, getDeviceName } from "@/lib/deviceId";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

const ENABLED = import.meta.env.VITE_ENABLE_PLAYBACK_LIMIT === "true";
const TEST_EMAIL = (import.meta.env.VITE_PLAYBACK_TEST_EMAIL || "").trim().toLowerCase();

async function callFn(fn, body) {
  let { data: { session } } = await supabase.auth.getSession();

  // access_token ausente ou expirado → força refresh antes de chamar a Edge Function
  if (!session?.access_token) {
    const { data } = await supabase.auth.refreshSession();
    session = data?.session ?? null;
  }

  if (!session?.access_token) throw new Error("no_session");

  const res = await fetch(`${FN_BASE}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/**
 * @param {object} opts
 * @param {boolean} opts.shouldGuard
 * @param {string} opts.userEmail
 * @param {() => void} opts.onKick
 * @param {(info: object) => void} opts.onLimitReached
 */
export function usePlaybackGuard({ shouldGuard, userEmail, onKick, onLimitReached }) {
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const heartbeatRef = useRef(null);
  const channelRef = useRef(null);
  const deviceId = getDeviceId();

  const isTestUser = !TEST_EMAIL || (userEmail && userEmail.toLowerCase() === TEST_EMAIL);
  const guardActive = ENABLED && shouldGuard && isTestUser;

  const claim = useCallback(async (force = false) => {
    if (!guardActive) {
      setClaimed(true);
      return { allowed: true };
    }
    setClaiming(true);
    try {
      const { status, body } = await callFn("claim-playback", {
        device_id: deviceId,
        device_name: getDeviceName(),
        force,
      });
      if (status === 200 && body.allowed) {
        setClaimed(true);
        return { allowed: true, ...body };
      }
      if (status === 409) {
        onLimitReached?.(body);
        return { allowed: false, ...body };
      }
      return { allowed: false, error: body.error || "unknown" };
    } finally {
      setClaiming(false);
    }
  }, [guardActive, deviceId, onLimitReached]);

  const release = useCallback(async () => {
    if (!guardActive) return;
    try {
      await callFn("release-playback", { device_id: deviceId });
    } catch {}
    setClaimed(false);
  }, [guardActive, deviceId]);

  // Heartbeat enquanto reproduzindo
  useEffect(() => {
    if (!guardActive || !claimed) return;
    let running = true;
    const tick = async () => {
      if (!running) return;
      try {
        const { body } = await callFn("heartbeat", { device_id: deviceId });
        if (body.valid === false) {
          running = false;
          setClaimed(false);
          onKick?.();
        }
      } catch {}
    };
    heartbeatRef.current = setInterval(tick, 20000);
    return () => {
      running = false;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [guardActive, claimed, deviceId, onKick]);

  // Realtime: detecta DELETE da própria sessão por outro device
  useEffect(() => {
    if (!guardActive || !claimed) return;
    let cancelled = false;
    const setup = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const channel = supabase
        .channel(`playback_${user.id}_${deviceId}`)
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "playback_sessions",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (payload.old?.device_id === deviceId) {
              setClaimed(false);
              onKick?.();
            }
          }
        )
        .subscribe();
      channelRef.current = channel;
    };
    setup();
    return () => {
      cancelled = true;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [guardActive, claimed, deviceId, onKick]);

  // Release ao desmontar
  useEffect(() => {
    return () => {
      if (claimed) release();
    };
  }, [claimed, release]);

  // Release ao fechar aba (sendBeacon = best-effort, sem auth header)
  useEffect(() => {
    if (!guardActive || !claimed) return;
    const handleUnload = () => {
      try {
        const url = `${FN_BASE}/release-playback`;
        const data = JSON.stringify({ device_id: deviceId });
        navigator.sendBeacon?.(url, new Blob([data], { type: "application/json" }));
      } catch {}
    };
    window.addEventListener("pagehide", handleUnload);
    return () => window.removeEventListener("pagehide", handleUnload);
  }, [guardActive, claimed, deviceId]);

  return { claim, release, claiming, claimed, deviceId };
}
