// src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Eye, EyeOff, MonitorSmartphone } from "lucide-react";
import { useAuth } from "@/contexts/SupabaseAuthContext";

// ✅ TESTE — só ativa single session pra este email
// Para ativar pra TODOS: mude para null
const SINGLE_SESSION_TEST_EMAIL = "tesagencia@gmail.com";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { kickedOut, clearKickedOut } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Modal: conta ativa em outro device (ao tentar logar)
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [pendingCredentials, setPendingCredentials] = useState(null);
  const [evictingDevice, setEvictingDevice] = useState(false);

  // Modal: você foi kickado por outro device
  const [showKickedModal, setShowKickedModal] = useState(false);

  // ✅ Se chegou na tela de login porque foi kickado, mostra o modal
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

  const shouldCheckSingleSession = (email) => {
    if (!SINGLE_SESSION_TEST_EMAIL) return true; // null = todos
    return email === SINGLE_SESSION_TEST_EMAIL;
  };

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

      if (error || !data) return false; // sem registro → primeiro login → libera
      if (myVersion && data.session_version === myVersion) return false; // mesmo device
      return true; // outro device ativo
    } catch {
      return false; // fail-open
    }
  };

  // Grava UUID novo no banco e no localStorage — sobrescreve o outro device
  const registerSession = async (userId) => {
    const newVersion = crypto.randomUUID();
    await supabase
      .from("active_sessions")
      .upsert(
        { user_id: userId, session_version: newVersion, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    try { window.localStorage.setItem(`dp_sv_${userId}`, newVersion); } catch {}
    return newVersion;
  };

  // ✅ Usuário confirmou: derruba o outro device e entra
  // O Realtime vai notificar o outro device e derrubar em < 1s
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
        // Sobrescreve UUID no banco → Realtime derruba o outro device instantaneamente
        await registerSession(userId);
      }

      setShowDeviceModal(false);
      setPendingCredentials(null);
      navigate("/");
    } catch (err) {
      console.error("evictAndLogin error:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setEvictingDevice(false);
    }
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

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        toast({ title: "Erro ao entrar", description: "WhatsApp/email ou senha incorretos.", variant: "destructive" });
        return;
      }

      const userId = data?.user?.id;

      // ✅ Verifica conflito de device
      if (userId && shouldCheckSingleSession(email)) {
        const hasOtherDevice = await checkActiveSession(userId);

        if (hasOtherDevice) {
          // Desloga temporariamente — o modal decide o próximo passo
          await supabase.auth.signOut();
          setPendingCredentials({ email, password });
          setShowDeviceModal(true);
          return;
        }
      }

      // Sem conflito → registra e navega
      if (userId) await registerSession(userId);
      navigate("/");
    } catch (err) {
      console.error("Erro inesperado:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
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

          <Link to="/reset-password" className="block mt-4 text-sm text-purple-400 hover:underline text-center">
            Esqueci minha senha
          </Link>

          <p className="text-slate-400 text-sm mt-6 text-center">
            Não tem conta?{" "}
            <Link to="/signup" className="text-purple-400 hover:underline">Criar conta</Link>
          </p>
        </div>
      </div>

      {/* Modal: conta ativa em outro device */}
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
                {evictingDevice ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Entrando...</> : "Entrar aqui e desconectar o outro"}
              </Button>
              <Button
                variant="outline"
                className="w-full h-11 border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={() => { setShowDeviceModal(false); setPendingCredentials(null); }}
                disabled={evictingDevice}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Modal: você foi desconectado por outro device */}
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
