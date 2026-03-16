// src/pages/Login.jsx
import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Eye, EyeOff, MonitorSmartphone } from "lucide-react";

// ✅ TESTE — só ativa o single session pra este email
const SINGLE_SESSION_TEST_EMAIL = "tesagencia@gmail.com";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ✅ NOVO — estados do modal de dispositivo ativo
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [pendingCredentials, setPendingCredentials] = useState(null); // { email, password }
  const [evictingDevice, setEvictingDevice] = useState(false);

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

  // ✅ NOVO — verifica se tem outro device logado nessa conta
  const checkActiveSession = async (userId) => {
    try {
      const myVersion = (() => {
        try { return window.localStorage.getItem(`dp_sv_${userId}`) || null; } catch { return null; }
      })();

      const { data, error } = await supabase
        .from("active_sessions")
        .select("session_version")
        .eq("user_id", userId)
        .maybeSingle();

      if (error || !data) return false; // sem registro no banco → primeiro login → libera
      if (myVersion && data.session_version === myVersion) return false; // é este mesmo device
      return true; // UUID diferente → outro device ativo
    } catch {
      return false; // fail-open: erro de rede não bloqueia o login
    }
  };

  // ✅ NOVO — usuário confirmou: derruba o outro device e entra
  const evictAndLogin = async () => {
    if (!pendingCredentials) return;
    setEvictingDevice(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: pendingCredentials.email,
        password: pendingCredentials.password,
      });

      if (error) {
        toast({
          title: "Erro ao entrar",
          description: "Senha incorreta ou sessão expirada. Tente novamente.",
          variant: "destructive",
        });
        setShowDeviceModal(false);
        setPendingCredentials(null);
        return;
      }

      const userId = data?.user?.id;
      if (userId) {
        // Sobrescreve UUID no banco → Realtime notifica o outro device → deslogado na hora
        const newVersion = crypto.randomUUID();
        await supabase
          .from("active_sessions")
          .upsert(
            {
              user_id: userId,
              session_version: newVersion,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );
        try { window.localStorage.setItem(`dp_sv_${userId}`, newVersion); } catch {}
      }

      setShowDeviceModal(false);
      setPendingCredentials(null);
      navigate("/");
    } catch (err) {
      console.error("evictAndLogin error:", err);
      toast({
        title: "Erro inesperado",
        description: "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setEvictingDevice(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!identifier || !password) {
      toast({
        title: "Atenção",
        description: "Preencha WhatsApp (ou email) e senha.",
        variant: "destructive",
      });
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

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error("Erro login:", error);
        toast({
          title: "Erro ao entrar",
          description: "WhatsApp/email ou senha incorretos.",
          variant: "destructive",
        });
        return;
      }

      const userId = data?.user?.id;

      // ✅ NOVO — só verifica outro device se for o email de teste
      if (userId && email === SINGLE_SESSION_TEST_EMAIL) {
        const hasOtherDevice = await checkActiveSession(userId);

        if (hasOtherDevice) {
          // Desloga temporariamente pra não ficar com sessão "solta"
          await supabase.auth.signOut();
          setPendingCredentials({ email, password });
          setShowDeviceModal(true);
          return; // para aqui — o modal decide o próximo passo
        }
      }

      // Sem conflito de device → registra e navega (igual ao original)
      try {
        if (userId) {
          const newVersion = crypto.randomUUID();
          await supabase
            .from("active_sessions")
            .upsert(
              {
                user_id: userId,
                session_version: newVersion,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" }
            );
          try { window.localStorage.setItem(`dp_sv_${userId}`, newVersion); } catch {}
        }
      } catch (e2) {
        console.error("[active_sessions] erro ao registrar device no login:", e2);
      }

      navigate("/");
    } catch (err) {
      console.error("Erro inesperado:", err);
      toast({
        title: "Erro inesperado",
        description: "Tente novamente mais tarde.",
        variant: "destructive",
      });
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
        <title>Entrar — DoramaStream</title>
      </Helmet>

      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="max-w-md w-full bg-slate-900/95 p-6 rounded-2xl border border-slate-800 shadow-lg">
          <h1 className="text-3xl font-bold mb-1 text-purple-400">Bem-vindo</h1>
          <p className="text-slate-300 text-sm mb-6">
            Entre na sua conta para continuar.
          </p>

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
                  {showPassword ? (
                    <Eye className="w-5 h-5 text-slate-100" />
                  ) : (
                    <EyeOff className="w-5 h-5 text-slate-100" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>

          <Link
            to="/reset-password"
            className="block mt-4 text-sm text-purple-400 hover:underline text-center"
          >
            Esqueci minha senha
          </Link>

          <p className="text-slate-400 text-sm mt-6 text-center">
            Não tem conta?{" "}
            <Link to="/signup" className="text-purple-400 hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>

      {/* ✅ NOVO — Modal: conta ativa em outro dispositivo */}
      {showDeviceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <MonitorSmartphone className="w-7 h-7 text-purple-400 shrink-0" />
              <h2 className="text-lg font-bold text-slate-50 leading-tight">
                Conta ativa em outro dispositivo
              </h2>
            </div>

            <p className="text-slate-300 text-sm mb-6 leading-relaxed">
              Sua conta já está sendo usada em outro dispositivo. Se continuar,
              o outro dispositivo será desconectado automaticamente.
            </p>

            <div className="flex flex-col gap-3">
              <Button
                className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white"
                onClick={evictAndLogin}
                disabled={evictingDevice}
              >
                {evictingDevice ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  "Entrar aqui e desconectar o outro"
                )}
              </Button>

              <Button
                variant="outline"
                className="w-full h-11 border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={() => {
                  setShowDeviceModal(false);
                  setPendingCredentials(null);
                }}
                disabled={evictingDevice}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Login;
