import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Eye, EyeOff } from "lucide-react";

const RedefinirSenha = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [checkingLink, setCheckingLink] = useState(true);
  const [validLink, setValidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkRecoverySession = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        setValidLink(!error && !!data?.user);
      } catch {
        setValidLink(false);
      } finally {
        setCheckingLink(false);
      }
    };
    checkRecoverySession();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!password || !passwordConfirm) {
      toast({ title: "Preencha os dois campos.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Senha muito curta", description: "Mínimo 6 caracteres.", variant: "destructive" });
      return;
    }
    if (password !== passwordConfirm) {
      toast({ title: "Senhas diferentes", description: "A confirmação não confere.", variant: "destructive" });
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        toast({
          title: "Erro ao redefinir senha",
          description: error.message || "Solicite outro link.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Senha alterada!", description: "Faça login com a nova senha." });
      await supabase.auth.signOut();
      navigate("/login");
    } catch {
      toast({ title: "Erro inesperado", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (checkingLink) {
    return (
      <>
        <Helmet><title>Redefinir senha — DoramasPlus</title></Helmet>
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin h-8 w-8 text-purple-400" />
            <p>Verificando link...</p>
          </div>
        </div>
      </>
    );
  }

  if (!validLink) {
    return (
      <>
        <Helmet><title>Link inválido — DoramasPlus</title></Helmet>
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
          <div className="max-w-md w-full bg-slate-900/90 rounded-2xl p-6 border border-slate-800">
            <h1 className="text-xl font-semibold mb-3">Link inválido ou expirado</h1>
            <p className="text-sm text-slate-300 mb-4">
              Solicite um novo link de recuperação na tela de login.
            </p>
            <Button className="w-full" onClick={() => navigate("/esqueci-senha")}>
              Solicitar novo link
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Helmet><title>Definir nova senha — DoramasPlus</title></Helmet>
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="max-w-md w-full bg-slate-900/95 rounded-2xl p-6 border border-slate-800 shadow-lg">
          <h1 className="text-2xl font-semibold mb-1">Definir nova senha</h1>
          <p className="text-sm text-slate-300 mb-6">Escolha uma nova senha para sua conta.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm mb-1 block">Nova senha</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="h-12 text-base pr-10 bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-violet-500"
                />
                <button type="button" onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100">
                  {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm mb-1 block">Confirmar nova senha</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Repita a senha"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="h-12 text-base pr-10 bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-violet-500"
                />
                <button type="button" onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100">
                  {showPassword ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full mt-2 h-11 text-base" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : "Confirmar nova senha"}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
};

export default RedefinirSenha;
