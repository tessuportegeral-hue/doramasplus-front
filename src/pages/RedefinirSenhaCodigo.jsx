import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Eye, EyeOff } from "lucide-react";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const RedefinirSenhaCodigo = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const identifier = searchParams.get("identifier") || "";

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const inputBase =
    "w-full h-12 text-base bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 rounded-md px-3 " +
    "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500";

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      toast({ title: "Código inválido", description: "O código deve ter exatamente 6 dígitos.", variant: "destructive" });
      return;
    }

    if (newPassword.length < 6) {
      toast({ title: "Senha muito curta", description: "A senha deve ter no mínimo 6 caracteres.", variant: "destructive" });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({ title: "Senhas diferentes", description: "A confirmação não confere.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${FN_BASE}/verify-reset-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        body: JSON.stringify({ identifier, code, new_password: newPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        toast({
          title: "Erro ao redefinir",
          description: data.message || "Código inválido ou expirado.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Senha redefinida!", description: "Faça login com a nova senha." });
      navigate("/login");
    } catch {
      toast({ title: "Erro de conexão", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Redefinir senha — DoramasPlus</title>
      </Helmet>
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="max-w-md w-full bg-slate-900/95 p-6 rounded-2xl border border-slate-800 shadow-lg">
          <h1 className="text-2xl font-bold mb-1 text-purple-400">Redefinir senha</h1>
          <p className="text-slate-400 text-sm mb-6">
            Enviamos um código de 6 dígitos pelo WhatsApp para o número cadastrado.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm mb-1 block">Código de verificação</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={inputBase + " tracking-[0.4em] text-center text-lg font-semibold"}
              />
            </div>

            <div>
              <label className="text-sm mb-1 block">Nova senha</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputBase + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
                >
                  {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm mb-1 block">Confirmar nova senha</label>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputBase}
              />
            </div>

            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Redefinindo...</> : "Redefinir senha"}
            </Button>
          </form>

          <p className="text-slate-400 text-sm mt-5 text-center">
            Não recebi o código.{" "}
            <Link to="/esqueci-senha" className="text-purple-400 hover:underline">
              Tentar novamente
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default RedefinirSenhaCodigo;
