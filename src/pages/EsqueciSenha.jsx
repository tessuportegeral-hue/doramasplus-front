import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const EsqueciSenha = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentType, setSentType] = useState(""); // "email" | "phone"

  const digitsOnly = (v) => String(v || "").replace(/\D/g, "");

  const detectType = (raw) => {
    const v = String(raw || "").trim();
    if (!v) return null;
    if (v.includes("@") && !v.toLowerCase().endsWith("@doramasplus.com")) return "email";
    return "phone";
  };

  const normalizePhone = (raw) => {
    let d = digitsOnly(raw);
    if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
    return d;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const v = identifier.trim();
    if (!v) {
      toast({ title: "Preencha o campo", variant: "destructive" });
      return;
    }

    const type = detectType(v);
    if (!type) {
      toast({ title: "Identificador inválido", description: "Digite um e-mail ou WhatsApp com DDD.", variant: "destructive" });
      return;
    }

    const normalizedId = type === "phone" ? normalizePhone(v) : v.toLowerCase();

    if (type === "phone" && normalizedId.length < 10) {
      toast({ title: "WhatsApp inválido", description: "Digite com DDD. Ex: 11999999999", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await fetch(`${FN_BASE}/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        body: JSON.stringify({ identifier: normalizedId }),
      });

      setSentType(type);
      setSent(true);

      if (type === "phone") {
        navigate(`/redefinir-senha-codigo?identifier=${encodeURIComponent(normalizedId)}`);
      }
    } catch {
      toast({ title: "Erro de conexão", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const inputBase =
    "w-full h-12 text-base bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 rounded-md px-3 " +
    "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500";

  return (
    <>
      <Helmet>
        <title>Esqueci minha senha — DoramasPlus</title>
      </Helmet>
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="max-w-md w-full bg-slate-900/95 p-6 rounded-2xl border border-slate-800 shadow-lg">
          <h1 className="text-2xl font-bold mb-1 text-purple-400">Recuperar senha</h1>
          <p className="text-slate-400 text-sm mb-6">
            Informe seu e-mail ou WhatsApp cadastrado e enviaremos instruções de recuperação.
          </p>

          {sent && sentType === "email" ? (
            <div className="rounded-xl bg-emerald-900/30 border border-emerald-700/50 p-4 text-sm text-emerald-200 mb-6">
              Se o cadastro existir, enviamos um link por e-mail. Verifique sua caixa de entrada e spam.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm mb-1 block">E-mail ou WhatsApp</label>
                <input
                  type="text"
                  placeholder="seuemail@gmail.com ou 11999999999"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className={inputBase}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <p className="text-xs text-slate-500 mt-1">
                  WhatsApp: somente números com DDD.
                </p>
              </div>
              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : "Enviar instruções"}
              </Button>
            </form>
          )}

          <p className="text-slate-400 text-sm mt-6 text-center">
            Lembrou a senha?{" "}
            <Link to="/login" className="text-purple-400 hover:underline">Entrar</Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default EsqueciSenha;
