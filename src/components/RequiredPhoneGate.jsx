import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const digitsOnly = (v) => String(v || "").replace(/\D/g, "");

const RequirePhoneGate = ({ children }) => {
  const { user, loading } = useAuth();

  const [checking, setChecking] = useState(true);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const checkPhone = async () => {
      try {
        // esperando auth carregar
        if (loading) return;

        // se não estiver logado, não trava
        if (!user) {
          setNeedsPhone(false);
          setChecking(false);
          return;
        }

        // 🔎 tenta ler o phone do profile
        const { data, error } = await supabase
          .from("profiles")
          .select("phone")
          .eq("id", user.id)
          .maybeSingle();

        if (error) {
          console.error("[RequirePhoneGate] ERRO ao buscar profiles.phone:", error);

          // ✅ IMPORTANTE: se não conseguiu ler por RLS/policy/qualquer coisa,
          // assume que precisa do phone e TRAVA do mesmo jeito.
          setNeedsPhone(true);
          setChecking(false);
          return;
        }

        // se não tem linha ou phone vazio -> trava
        if (!data?.phone) {
          setNeedsPhone(true);
        } else {
          setNeedsPhone(false);
        }
      } catch (err) {
        console.error("[RequirePhoneGate] exception:", err);
        // ✅ se deu qualquer exception, trava pra garantir coleta
        setNeedsPhone(true);
      } finally {
        setChecking(false);
      }
    };

    checkPhone();
  }, [user, loading]);

  const handleSave = async () => {
    if (!user) return;

    const clean = digitsOnly(phone);

    // mínimo DDD + número
    if (clean.length < 10) {
      alert("Digite seu WhatsApp com DDD. Ex: 11999999999");
      return;
    }

    try {
      setSaving(true);

      // ✅ UPSERT (cria profile se não existir)
      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          phone: clean,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (error) {
        console.error("[RequirePhoneGate] erro ao salvar phone:", error);
        alert("Não consegui salvar seu WhatsApp. Tente novamente.");
        return;
      }

      setNeedsPhone(false);
    } catch (err) {
      console.error("[RequirePhoneGate] exception ao salvar:", err);
      alert("Erro inesperado ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  // enquanto está checando, não mostra nada (pra não piscar)
  if (checking) return children;

  return (
    <>
      {children}

      {needsPhone && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md text-center space-y-4">
            <h2 className="text-xl font-bold text-white">
              Complete seu cadastro 💜
            </h2>

            <p className="text-slate-300 text-sm">
              Para continuar usando a plataforma, informe seu WhatsApp (com DDD).
              É rapidinho e só precisa fazer uma vez.
            </p>

            <input
              type="tel"
              placeholder="Ex: 11999999999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-12 rounded-lg bg-slate-800 border border-slate-600 px-3 text-white"
            />

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-lg disabled:opacity-70"
            >
              {saving ? "Salvando..." : "Salvar e continuar"}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default RequirePhoneGate;
