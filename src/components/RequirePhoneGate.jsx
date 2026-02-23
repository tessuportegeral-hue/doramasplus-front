// src/components/RequirePhoneGate.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";
import { useLocation } from "react-router-dom";

const digitsOnly = (v) => String(v || "").replace(/\D/g, "");

const normalizeBRPhone = (raw) => {
  let d = digitsOnly(raw);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10) return "";
  if (d.length > 11) d = d.slice(-11);
  return d;
};

export default function RequirePhoneGate({ children }) {
  const auth = useAuth();
  const user = auth?.user || null;
  const loading = !!auth?.loading;
  const location = useLocation();

  // ✅ libera rotas de auth/login pra você não ficar preso
  const path = location?.pathname || "";
  const isAuthRoute =
    path === "/login" ||
    path.startsWith("/login/") ||
    path.startsWith("/auth") ||
    path.startsWith("/reset") ||
    path.startsWith("/signup");

  const [checking, setChecking] = useState(true);
  const [needsPhone, setNeedsPhone] = useState(false);

  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        // ✅ se estiver em rota de login/auth, não gateia
        if (isAuthRoute) {
          if (!cancelled) {
            setNeedsPhone(false);
            setChecking(false);
          }
          return;
        }

        // ✅ Enquanto auth tá carregando, segura a tela
        if (loading) {
          if (!cancelled) setChecking(true);
          return;
        }

        setErrMsg("");

        // ✅ Se não tem user, libera
        if (!user) {
          if (!cancelled) {
            setNeedsPhone(false);
            setChecking(false);
          }
          return;
        }

        // ✅ Checa profiles.phone
        const { data, error } = await supabase
          .from("profiles")
          .select("phone")
          .eq("id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error("[RequirePhoneGate] SELECT error:", error);
          setErrMsg(
            "Não consegui verificar seu WhatsApp agora. Recarregue a página."
          );
          setNeedsPhone(true); // por segurança: trava
          setChecking(false);
          return;
        }

        const currentPhone = String(data?.phone || "").trim();
        const hasPhone = !!normalizeBRPhone(currentPhone);

        setNeedsPhone(!hasPhone);
        setChecking(false);
      } catch (e) {
        console.error("[RequirePhoneGate] exception:", e);
        if (!cancelled) {
          setErrMsg("Erro ao verificar seu WhatsApp. Recarregue a página.");
          setNeedsPhone(true);
          setChecking(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [user, loading, isAuthRoute]);

  const handleSave = async () => {
    try {
      setErrMsg("");
      const normalized = normalizeBRPhone(phone);

      if (!normalized) {
        setErrMsg("Digite seu WhatsApp com DDD. Ex: 11999999999");
        return;
      }
      if (!user) return;

      setSaving(true);

      // ✅ UPSERT: cria o profile se não existir (resolve o “outro email” travado)
      const { error } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            phone: normalized,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );

      if (error) {
        console.error("[RequirePhoneGate] UPSERT error:", error);

        const msg = String(error.message || "").toLowerCase();
        const isDup =
          error.code === "23505" ||
          msg.includes("duplicate") ||
          msg.includes("unique");

        setErrMsg(
          isDup
            ? "Esse WhatsApp já está vinculado a outra conta."
            : `Não consegui salvar agora. ${error.message || "Tente novamente."}`
        );
        return;
      }

      // ✅ re-checa pra liberar com certeza
      setChecking(true);
      setNeedsPhone(false);
      setPhone("");
    } catch (e) {
      console.error("[RequirePhoneGate] save exception:", e);
      setErrMsg("Erro ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("[RequirePhoneGate] signOut exception:", e);
    }
  };

  // ✅ Enquanto checa, segura a tela
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="text-slate-300 text-sm">Carregando...</div>
      </div>
    );
  }

  // ✅ se estiver em login/auth, não mostra gate
  if (isAuthRoute) return children;

  if (!needsPhone) return children;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
      <div className="max-w-md w-full bg-slate-900/95 p-6 rounded-2xl border border-slate-800 shadow-lg">
        <h1 className="text-2xl font-bold text-purple-400 mb-2">
          Falta seu WhatsApp ✅
        </h1>

        <p className="text-slate-300 text-sm">
          Para continuar usando a plataforma, informe seu WhatsApp com DDD.
          Você só faz isso uma vez.
        </p>

        <div className="mt-4">
          <label className="text-sm mb-1 block">WhatsApp (com DDD)</label>
          <input
            type="tel"
            inputMode="numeric"
            placeholder="Ex: 11999999999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full h-12 rounded-lg bg-slate-950/60 border border-slate-700 px-3 text-slate-100 placeholder:text-slate-500 outline-none focus:border-purple-500/60"
          />
          {errMsg && <p className="text-sm text-red-400 mt-2">{errMsg}</p>}
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="mt-4 w-full h-11 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar e continuar"}
        </button>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 w-full h-10 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm"
        >
          Sair / trocar conta
        </button>
      </div>
    </div>
  );
}
