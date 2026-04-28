// src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Eye, EyeOff, MonitorSmartphone } from "lucide-react";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { kickedOut, clearKickedOut } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showConflictModal, setShowConflictModal] = useState(false);
  const [pendingUserId, setPendingUserId] = useState(null);
  const [forcingLogin, setForcingLogin] = useState(false);

  const [showKickedModal, setShowKickedModal] = useState(false);

  useEffect(() => {
    if (kickedOut) {
      setShowKickedModal(true);
      clearKickedOut();
    }
  }, [kickedOut, clearKickedOut]);

  const digitsOnly = (v) => String(v || "").replace(/\D/g, "");

  const normalizeIdentifierToEmail = (raw) => {
    const v = String(raw || "").trim().toLowerCase();
    if (!v) return "";
    if (v.includes("@")) return v;

    let d = digitsOnly(v);
    if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
    if (d.length < 10) return "";

    return `${d}@doramasplus.com`;
  };

  const registerSession = async (userId) => {
    const newVersion = crypto.randomUUID();
    localStorage.setItem(`dp_sv_${userId}`, newVersion);
    await supabase
      .from("active_sessions")
      .upsert({ user_id: userId, session_version: newVersion });
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!identifier || !password) {
      toast({ title: "Atenção", description: "Preencha WhatsApp (ou email) e senha.", variant: "destructive" });
      return;
    }

    const email = normalizeIdentifierToEmail(identifier);

    if (!email) {
      toast({
        title: "WhatsApp inválido",
        description: "Digite seu WhatsApp com DDD (somente números). Ex: 11999999999",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        toast({ title: "Erro ao entrar", description: "WhatsApp/email ou senha incorretos.", variant: "destructive" });
        return;
      }

      const TEST_EMAIL = (import.meta.env.VITE_PLAYBACK_TEST_EMAIL || "").toLowerCase();
      const userEmail = data.user?.email?.toLowerCase() || "";
      const isTestUser = !TEST_EMAIL || userEmail === TEST_EMAIL;

      if (isTestUser) {
        const deviceId = localStorage.getItem("dp_device_id") || crypto.randomUUID();
        localStorage.setItem("dp_device_id", deviceId);

        const { data: sessions } = await supabase
          .from("active_sessions")
          .select("session_version")
          .eq("user_id", data.user.id)
          .single();

        if (sessions) {
          const storedVersion = localStorage.getItem(`dp_sv_${data.user.id}`);
          if (!storedVersion) {
            // localStorage limpo (desconectou manualmente) → registra como primeiro login
            await registerSession(data.user.id);
          } else if (storedVersion !== sessions.session_version) {
            // Outro device ativo → mostra modal (mantém sessão ativa)
            setPendingUserId(data.user.id);
            setShowConflictModal(true);
            return;
          }
          // storedVersion bate → mesmo device, segue
        } else {
          // Nenhuma sessão registrada → primeiro login
          await registerSession(data.user.id);
        }
      }

      navigate("/");
    } catch (err) {
      console.error("Erro inesperado:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleForceLogin = async () => {
    if (!pendingUserId) return;
    setForcingLogin(true);
    try {
      // 1. Revoga todos os JWTs no servidor — invalida o device antigo
      await supabase.auth.signOut({ scope: "global" });

      // 2. Re-loga com token novo e limpo
      const email = normalizeIdentifierToEmail(identifier);
      const { data: freshData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || !freshData?.user) {
        toast({ title: "Erro ao entrar", description: "Tente fazer login novamente.", variant: "destructive" });
        setShowConflictModal(false);
        setPendingUserId(null);
        return;
      }

      // 3 & 4. Registra nova session_version no banco e localStorage
      await registerSession(freshData.user.id);

      setShowConflictModal(false);
      setPendingUserId(null);
      navigate("/");
    } catch (err) {
      console.error("handleForceLogin error:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setForcingLogin(false);
    }
  };

  const handleCancelConflict = async () => {
    await supabase.auth.signOut();
    setShowConflictModal(false);
    setPendingUserId(null);
  };

  const inputBase =
    "w-full h-12 text-base bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 rounded-md px-3 " +
    "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500";

  return (
    <>
      <Helmet>
        <title>Entrar — DoramasPlus</title>
      </Helmet>

      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="max-w-md w-full bg-slate-900/95 p-6 rounded-2xl border border-slate-800 shadow-lg">
          <h1 className="text-3xl font-bold mb-1 text-purple-400">Bem-vindo</h1>
          <p className="text-slate-300 text-sm mb-6">Entre na sua conta para continuar.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-sm mb-1 block">Email ou WhatsApp</label>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Ex: 11999999999 ou email@..."
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputBase}
              />
              <p className="text-xs text-slate-500 mt-1">
                WhatsApp: use com DDD (somente números). Email: digite normal com @.
              </p>
            </div>

            <div>
              <label className="text-sm mb-1 block">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputBase + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-90 hover:opacity-100"
                >
                  {showPassword ? <Eye className="w-5 h-5 text-slate-100" /> : <EyeOff className="w-5 h-5 text-slate-100" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Entrando...</> : "Entrar"}
            </Button>
          </form>

          <Link to="/esqueci-senha" className="block mt-4 text-sm text-purple-400 hover:underline text-center">
            Esqueci minha senha
          </Link>

          <p className="text-slate-400 text-sm mt-6 text-center">
            Não tem conta?{" "}
            <Link to="/signup" className="text-purple-400 hover:underline">Criar conta</Link>
          </p>
        </div>
      </div>

      {/* Modal: conta em uso em outro dispositivo */}
      {showConflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <MonitorSmartphone className="w-7 h-7 text-purple-400 shrink-0" />
              <h2 className="text-lg font-bold text-slate-50 leading-tight">
                Conta em uso em outro dispositivo
              </h2>
            </div>
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              Sua conta está ativa em outro dispositivo. Deseja desconectar o outro e entrar aqui?
            </p>
            <div className="flex flex-col gap-3">
              <Button
                className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white"
                onClick={handleForceLogin}
                disabled={forcingLogin}
              >
                {forcingLogin ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Entrando...</> : "Entrar aqui"}
              </Button>
              <Button
                variant="outline"
                className="w-full h-11 border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={handleCancelConflict}
                disabled={forcingLogin}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: você foi desconectado por outro device */}
      {showKickedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-900 border border-red-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <MonitorSmartphone className="w-7 h-7 text-red-400 shrink-0" />
              <h2 className="text-lg font-bold text-slate-50 leading-tight">
                Você foi desconectado
              </h2>
            </div>
            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              Sua sessão foi encerrada porque outro dispositivo entrou na mesma conta.
              Faça login novamente para continuar assistindo.
            </p>
            <Button
              className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white"
              onClick={() => setShowKickedModal(false)}
            >
              Entendido
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default Login;
