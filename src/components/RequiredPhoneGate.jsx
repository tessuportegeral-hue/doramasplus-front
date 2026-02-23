// src/components/RequirePhoneGate.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const digitsOnly = (v) => String(v || "").replace(/\D/g, "");

// Normaliza telefone: aceita 11 dígitos (DDD+número) e também 13 com 55 na frente
const normalizeBRPhone = (raw) => {
  let d = digitsOnly(raw);

  // remove +55/55 se vier junto
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);

  // precisa ter pelo menos 10 (DDD+fixo) mas ideal 11 (DDD+celular)
  if (d.length < 10) return "";

  // se tiver mais que 11 por algum motivo, corta no final
  if (d.length > 11) d = d.slice(-11);

  return d;
};

export default function RequirePhoneGate({ children }) {
  const { user, loading } = useAuth();

  const [checking, setChecking] = useState(true);
  const [needsPhone, setNeedsPhone] = useState(false);

  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    const checkPhone = async () => {
      try {
        setErrMsg("");

        // ainda carregando auth -> espera
        if (loading) return;

        // ✅ não logado -> não trava nada
        if (!user) {
          if (!cancelled) {
            setNeedsPhone(false);
            setChecking(false);
          }
          return;
        }

        // ✅ logado -> checa profiles.phone
        const { data, error } = await supabase
          .from("profiles")
          .select("phone")
          .eq("id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error("[RequirePhoneGate] erro SELECT profiles.phone:", error);
          // Se der erro aqui, a gente NÃO libera silencioso sem você ver:
          setErrMsg("Não consegui verificar seu WhatsApp agora. Tente recarregar a página.");
          // por segurança, trava (gate)
          setNeedsPhone(true);
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

    checkPhone();

    return () => {
      cancelled = true;
    };
  }, [loading, user]);

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

      const { error } = await supabase
        .from("profiles")
        .update({
          phone: normalized,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) {
        console.error("[RequirePhoneGate] erro UPDATE profiles.phone:", error);
        setErrMsg("Não consegui salvar agora. Tente novamente.");
        return;
      }

      // ✅ liberou
      setNeedsPhone(false);
    } catch (e) {
      console.error("[RequirePhoneGate] exception save:", e);
      setErrMsg("Erro ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  // Enquanto checa, deixa carregando
  if (checking) return children;

  // Se não precisa de phone, libera tudo
  if (!needsPhone) return children;

  // ✅ Gate bloqueando tudo
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
      <div className="max-w-md w-full bg-slate-900/95 p-6 rounded-2xl border border-slate-800 shadow-lg">
        <h1 className="text-2xl font-bold text-purple-400 mb-2">
          Falta seu WhatsApp ✅
        </h1>

        <p className="text-slate-300 text-sm">
          Para continuar assistindo e receber avisos, informe seu WhatsApp com DDD.
          Isso é rápido e você só faz uma vez.
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
      </div>
    </div>
  );
}
