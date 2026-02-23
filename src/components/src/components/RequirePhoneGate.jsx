import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const RequirePhoneGate = ({ children }) => {
  const { user, loading } = useAuth();

  const [checking, setChecking] = useState(true);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const checkPhone = async () => {
      try {
        if (loading) return;

        if (!user) {
          setChecking(false);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("phone")
          .eq("id", user.id)
          .maybeSingle();

        if (error) {
          console.error("Erro ao buscar phone:", error);
          setChecking(false);
          return;
        }

        if (!data?.phone) {
          setNeedsPhone(true);
        }

      } catch (err) {
        console.error(err);
      } finally {
        setChecking(false);
      }
    };

    checkPhone();
  }, [user, loading]);

  const handleSave = async () => {
    if (!phone || phone.length < 10) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from("profiles")
        .update({
          phone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) {
        console.error(error);
        return;
      }

      setNeedsPhone(false);

    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (checking) return null;

  return (
    <>
      {children}

      {needsPhone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md text-center space-y-4">

            <h2 className="text-xl font-bold text-white">
              Complete seu cadastro 💜
            </h2>

            <p className="text-slate-300 text-sm">
              Para continuar assistindo, informe seu WhatsApp.
              Isso é rápido e só precisa fazer uma vez.
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
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-lg"
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
