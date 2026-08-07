// src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Eye, EyeOff, MonitorSmartphone, Mail, KeyRound, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/SupabaseAuthContext";

// ✅ 29/07 — aposentado (modelo "Netflix"): login livre em vários
// dispositivos pra todo mundo, trava só na hora de assistir via
// claim-playback. Testado com tesagencia antes de liberar geral. Não
// reativar sem repensar o fluxo — espelhar com SupabaseAuthContext.jsx e
// DoramaWatch.jsx.

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { kickedOut, clearKickedOut } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ✅ 07/08 — login sem senha por código no email (pedido: "Dramio tem
  // isso também"). Usa o OTP nativo do Supabase — manda um código de 6
  // dígitos por email, sem precisar de edge function nem lógica nova no
  // banco. Só funciona pra contas com email de verdade (WhatsApp vira um
  // email sintético @doramasplus.com que não recebe nada de verdade).
  // "loginMode": 'password' | 'code-request' | 'code-verify' | 'set-password'
  const [loginMode, setLoginMode] = useState("password");
  const [codeEmail, setCodeEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);

  // Passo 3 (opcional, após entrar por código): definir senha nova
  const [newPasswordAfterCode, setNewPasswordAfterCode] = useState("");
  const [confirmPasswordAfterCode, setConfirmPasswordAfterCode] = useState("");
  const [showNewPasswordAfterCode, setShowNewPasswordAfterCode] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);

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

  const shouldCheckSingleSession = (_email) => false;

  // ✅ FIX: grava o UUID deste device IMEDIATAMENTE no banco
  // Isso garante que o device novo tem prioridade antes do contexto inicializar
  const registerSessionImmediate = async (userId, email) => {
    const newVersion = crypto.randomUUID();

    // Confere que o JWT atual é realmente desse userId antes de escrever.
    // Sem isso, uma troca de conta na mesma aba (ou uma chamada que ficou
    // pendente enquanto o usuário trocava) pode tentar gravar user_id de
    // uma sessão que não é mais a autenticada, e o Postgres rejeita com
    // RLS 42501 (o token já não bate mais com o user_id enviado).
    const { data: authData } = await supabase.auth.getUser();
    if (authData?.user?.id !== userId) {
      console.warn("[login] registerSession: JWT não confere com userId, pulando write");
      return null;
    }

    // Grava no banco (upsert = sobrescreve o device antigo)
    const { error } = await supabase
      .from("active_sessions")
      .upsert(
        { user_id: userId, session_version: newVersion, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[login] registerSession error:", error);
      return null;
    }

    // Grava no localStorage para o contexto encontrar depois
    try { window.localStorage.setItem(`dp_sv_${userId}`, newVersion); } catch {}

    return newVersion;
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

  // ✅ Usuário confirmou: derruba o outro device e entra
  // Grava o UUID novo ANTES do contexto inicializar — o device antigo cai via Realtime em < 1s
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
        // ✅ Grava UUID novo imediatamente — sobrescreve o antigo no banco
        // O Realtime notifica o device antigo em < 1s e ele é kickado
        await registerSessionImmediate(userId, pendingCredentials.email);
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

      // Sem conflito → grava UUID e navega
      // ✅ IMPORTANTE: grava ANTES do contexto inicializar o polling
      if (userId && shouldCheckSingleSession(email)) {
        await registerSessionImmediate(userId, email);
      }

      navigate("/");
    } catch (err) {
      console.error("Erro inesperado:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // -------- Login sem senha: passo 1, manda o código --------
  const handleSendCode = async (e) => {
    e.preventDefault();
    const cleanEmail = codeEmail.trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes("@")) {
      toast({ title: "Email inválido", description: "Digite um email válido.", variant: "destructive" });
      return;
    }

    try {
      setSendingCode(true);

      // shouldCreateUser:false — é login, não cadastro. Se o email não
      // tiver conta, o Supabase não cria uma nova nem revela isso (evita
      // vazar quais emails existem), então a mensagem de sucesso é sempre
      // a mesma; se não tiver conta, o código simplesmente não chega.
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: false },
      });

      if (error) {
        toast({
          title: "Erro ao enviar código",
          description: error.message || "Tente novamente em instantes.",
          variant: "destructive",
        });
        return;
      }

      setLoginMode("code-verify");
      toast({
        title: "Código enviado!",
        description: `Confira ${cleanEmail} (e o spam) e digite o código de 8 dígitos.`,
      });
    } catch (err) {
      console.error("Erro ao enviar código:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setSendingCode(false);
    }
  };

  // -------- Login sem senha: passo 2, confirma o código --------
  const handleVerifyCode = async (e) => {
    e.preventDefault();
    const cleanCode = otpCode.trim();

    if (cleanCode.length < 8) {
      toast({ title: "Código incompleto", description: "Digite os 8 dígitos do código.", variant: "destructive" });
      return;
    }

    try {
      setVerifyingCode(true);

      const { error } = await supabase.auth.verifyOtp({
        email: codeEmail.trim().toLowerCase(),
        token: cleanCode,
        type: "email",
      });

      if (error) {
        toast({
          title: "Código incorreto ou expirado",
          description: "Confira o código ou peça um novo.",
          variant: "destructive",
        });
        return;
      }

      // ✅ 07/08 — em vez de já navegar, oferece definir uma senha nova
      // (sem pedir a antiga — provar acesso ao email já é prova suficiente,
      // mesma lógica de segurança que o link de recuperação usava antes).
      setLoginMode("set-password");
    } catch (err) {
      console.error("Erro ao confirmar código:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setVerifyingCode(false);
    }
  };

  // -------- Login sem senha: passo 3 (opcional), definir senha nova --------
  const handleSetNewPassword = async (e) => {
    e.preventDefault();

    if (newPasswordAfterCode.length < 6) {
      toast({ title: "Senha muito curta", description: "A nova senha deve ter pelo menos 6 caracteres.", variant: "destructive" });
      return;
    }

    if (newPasswordAfterCode !== confirmPasswordAfterCode) {
      toast({ title: "Senhas diferentes", description: "A confirmação não confere com a nova senha.", variant: "destructive" });
      return;
    }

    try {
      setSettingPassword(true);

      const { error } = await supabase.auth.updateUser({ password: newPasswordAfterCode });

      if (error) {
        toast({
          title: "Erro ao definir senha",
          description: error.message || "Tente novamente em instantes.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Senha definida!", description: "Você já pode entrar com email/WhatsApp e senha também." });
      navigate("/");
    } catch (err) {
      console.error("Erro ao definir senha:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setSettingPassword(false);
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
          {loginMode === "password" && (
            <>
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

              <button
                type="button"
                onClick={() => setLoginMode("code-request")}
                className="block mt-4 text-sm text-purple-400 hover:underline text-center w-full"
              >
                Entrar sem senha (código por email)
              </button>

              <p className="text-slate-400 text-sm mt-6 text-center">
                Não tem conta?{" "}
                <Link to="/signup" className="text-purple-400 hover:underline">Criar conta</Link>
              </p>
            </>
          )}

          {loginMode === "code-request" && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Mail className="w-5 h-5 text-purple-400" />
                <h1 className="text-2xl font-bold">Entrar sem senha</h1>
              </div>
              <p className="text-slate-300 text-sm mb-6">
                Digite o email da sua conta. Mandamos um código de 8 dígitos pra você entrar na hora.
              </p>

              <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                  <label className="text-sm mb-1 block">Email</label>
                  <input
                    type="email"
                    placeholder="seuemail@exemplo.com"
                    value={codeEmail}
                    onChange={(e) => setCodeEmail(e.target.value)}
                    autoComplete="email"
                    className={inputBase}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Só funciona se sua conta tiver um email de verdade (não WhatsApp).
                  </p>
                </div>

                <Button type="submit" className="w-full h-11 text-base" disabled={sendingCode}>
                  {sendingCode ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : "Enviar código"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => setLoginMode("password")}
                className="flex items-center justify-center gap-1 mt-4 text-sm text-purple-400 hover:underline mx-auto"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar pro login com senha
              </button>
            </>
          )}

          {loginMode === "code-verify" && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="w-5 h-5 text-purple-400" />
                <h1 className="text-2xl font-bold">Digite o código</h1>
              </div>
              <p className="text-slate-300 text-sm mb-6">
                Enviamos um código de 8 dígitos pra <strong>{codeEmail.trim().toLowerCase()}</strong>.
              </p>

              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div>
                  <label className="text-sm mb-1 block">Código</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder="00000000"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className={inputBase + " text-center text-2xl tracking-[0.35em]"}
                  />
                </div>

                <Button type="submit" className="w-full h-11 text-base" disabled={verifyingCode}>
                  {verifyingCode ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirmando...</> : "Confirmar e entrar"}
                </Button>
              </form>

              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendingCode}
                className="block mt-4 text-sm text-purple-400 hover:underline text-center w-full disabled:opacity-60"
              >
                {sendingCode ? "Enviando novo código..." : "Não recebeu? Enviar novo código"}
              </button>

              <button
                type="button"
                onClick={() => setLoginMode("password")}
                className="flex items-center justify-center gap-1 mt-2 text-sm text-slate-400 hover:text-purple-400 hover:underline mx-auto"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar pro login com senha
              </button>
            </>
          )}

          {loginMode === "set-password" && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="w-5 h-5 text-purple-400" />
                <h1 className="text-2xl font-bold">Defina uma senha (opcional)</h1>
              </div>
              <p className="text-slate-300 text-sm mb-6">
                Você já está logado. Se quiser, aproveita e define uma senha nova
                pra próxima vez — sem precisar da antiga.
              </p>

              <form onSubmit={handleSetNewPassword} className="space-y-4">
                <div>
                  <label className="text-sm mb-1 block">Nova senha</label>
                  <div className="relative">
                    <input
                      type={showNewPasswordAfterCode ? "text" : "password"}
                      placeholder="Pelo menos 6 caracteres"
                      value={newPasswordAfterCode}
                      onChange={(e) => setNewPasswordAfterCode(e.target.value)}
                      autoComplete="new-password"
                      className={inputBase + " pr-10"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPasswordAfterCode((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 opacity-90 hover:opacity-100"
                    >
                      {showNewPasswordAfterCode ? <Eye className="w-5 h-5 text-slate-100" /> : <EyeOff className="w-5 h-5 text-slate-100" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm mb-1 block">Confirmar nova senha</label>
                  <input
                    type={showNewPasswordAfterCode ? "text" : "password"}
                    placeholder="Repita a senha"
                    value={confirmPasswordAfterCode}
                    onChange={(e) => setConfirmPasswordAfterCode(e.target.value)}
                    autoComplete="new-password"
                    className={inputBase}
                  />
                </div>

                <Button type="submit" className="w-full h-11 text-base" disabled={settingPassword}>
                  {settingPassword ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : "Salvar senha e continuar"}
                </Button>
              </form>

              <button
                type="button"
                onClick={() => navigate("/")}
                className="block mt-4 text-sm text-slate-400 hover:text-purple-400 hover:underline text-center w-full"
              >
                Pular por agora
              </button>
            </>
          )}
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
