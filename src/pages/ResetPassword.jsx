import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Eye, EyeOff, Mail, CheckCircle2 } from 'lucide-react';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // 'checking' | 'request' | 'reset' | 'invalid'
  const [mode, setMode] = useState('checking');

  // Fluxo 1: pedir recuperação por email
  const [email, setEmail] = useState('');
  const [requestSent, setRequestSent] = useState(false);

  // Fluxo 2: definir nova senha
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);

  // Decide o fluxo com base na URL:
  // - sem indicador de recuperação → formulário pra pedir email
  // - com indicador → aguarda sessão de recuperação e abre o formulário de nova senha
  useEffect(() => {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const hasRecoveryHash =
      hash.includes('type=recovery') || hash.includes('access_token');
    const hasRecoveryQuery =
      search.includes('code=') ||
      search.includes('token=') ||
      search.includes('recovery=1');

    if (!hasRecoveryHash && !hasRecoveryQuery) {
      setMode('request');
      return;
    }

    let resolved = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        resolved = true;
        setMode('reset');
      }
    });

    // Fallback: se em 4s nenhum evento disparou, valida com getSession
    const t = setTimeout(async () => {
      if (resolved) return;
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          setMode('reset');
        } else {
          setMode('invalid');
        }
      } catch {
        setMode('invalid');
      }
    }, 4000);

    return () => {
      clearTimeout(t);
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // -------- Fluxo 1: pedir email de recuperação --------
  const handleRequestReset = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      toast({
        title: 'Informe seu email',
        description: 'Digite o email da sua conta para enviarmos o link.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: 'https://doramasplus.com.br/reset-password',
      });

      if (error) {
        console.error('Erro ao solicitar recuperação:', error);
        toast({
          title: 'Erro ao enviar email',
          description: error.message || 'Tente novamente em alguns instantes.',
          variant: 'destructive',
        });
        return;
      }

      setRequestSent(true);
      toast({
        title: 'Email enviado!',
        description:
          'Confira sua caixa de entrada (e o spam) e siga o link para redefinir sua senha.',
      });
    } catch (err) {
      console.error('Erro inesperado ao solicitar recuperação:', err);
      toast({
        title: 'Erro inesperado',
        description: 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // -------- Fluxo 2: definir nova senha --------
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!password || !passwordConfirm) {
      toast({
        title: 'Atenção',
        description: 'Preencha os dois campos de senha.',
        variant: 'destructive',
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: 'Senha muito curta',
        description: 'A nova senha deve ter pelo menos 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    if (password !== passwordConfirm) {
      toast({
        title: 'Senhas diferentes',
        description: 'A confirmação de senha não confere com a nova senha.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        console.error('Erro ao atualizar senha:', error);
        toast({
          title: 'Erro ao redefinir senha',
          description:
            error.message ||
            'Não foi possível redefinir sua senha. Tente solicitar outro link.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Senha alterada com sucesso!',
        description: 'Faça login novamente com sua nova senha.',
      });

      navigate('/login');
    } catch (err) {
      console.error('Erro inesperado ao redefinir senha:', err);
      toast({
        title: 'Erro inesperado',
        description: 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // ----- Loading inicial enquanto decide o modo -----
  if (mode === 'checking') {
    return (
      <>
        <Helmet>
          <title>Recuperar senha | DoramasPlus</title>
        </Helmet>
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin h-8 w-8" />
            <p>Verificando link de recuperação...</p>
          </div>
        </div>
      </>
    );
  }

  // ----- Modo 1: pedir recuperação por email -----
  if (mode === 'request') {
    return (
      <>
        <Helmet>
          <title>Recuperar senha | DoramasPlus</title>
        </Helmet>
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
          <div className="max-w-md w-full bg-slate-900/95 rounded-2xl p-6 shadow-lg border border-slate-800">
            {requestSent ? (
              <div className="text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                <h1 className="text-2xl font-semibold mb-2">Email enviado!</h1>
                <p className="text-sm text-slate-300 mb-6">
                  Enviamos um link de recuperação para <strong>{email}</strong>.
                  Confira sua caixa de entrada e a pasta de spam.
                </p>
                <Button className="w-full" onClick={() => navigate('/login')}>
                  Voltar para o login
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-5 h-5 text-violet-400" />
                  <h1 className="text-2xl font-semibold">Recuperar senha</h1>
                </div>
                <p className="text-sm text-slate-300 mb-6">
                  Digite o email da sua conta. Enviaremos um link para você
                  definir uma nova senha.
                </p>

                <form onSubmit={handleRequestReset} className="space-y-4">
                  <div>
                    <label className="text-sm mb-1 block">Email</label>
                    <Input
                      type="email"
                      placeholder="seuemail@exemplo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="h-12 text-base bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full mt-2 h-11 text-base"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      'Enviar link de recuperação'
                    )}
                  </Button>
                </form>

                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="block mt-4 text-sm text-violet-400 hover:underline mx-auto"
                >
                  Voltar para o login
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ----- Link inválido / expirado -----
  if (mode === 'invalid') {
    return (
      <>
        <Helmet>
          <title>Link inválido | DoramasPlus</title>
        </Helmet>
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
          <div className="max-w-md w-full bg-slate-900/90 rounded-2xl p-6 shadow-lg border border-slate-800">
            <h1 className="text-xl font-semibold mb-3">
              Link de recuperação inválido ou expirado
            </h1>
            <p className="text-sm text-slate-300 mb-4">
              Solicite uma nova recuperação de senha.
              Por segurança, cada link só pode ser usado por um tempo limitado.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                window.location.replace('/reset-password');
              }}
            >
              Solicitar novo link
            </Button>
          </div>
        </div>
      </>
    );
  }

  // ----- Modo 2: definir nova senha (após clicar no link do email) -----
  return (
    <>
      <Helmet>
        <title>Redefinir senha | DoramasPlus</title>
      </Helmet>
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="max-w-md w-full bg-slate-900/95 rounded-2xl p-6 shadow-lg border border-slate-800">
          <h1 className="text-2xl font-semibold mb-1">Definir nova senha</h1>
          <p className="text-sm text-slate-300 mb-6">
            Escolha uma nova senha para acessar sua conta.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm mb-1 block">Nova senha</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Digite a nova senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="h-12 text-base pr-10 bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-90 hover:opacity-100"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5 text-slate-100" />
                  ) : (
                    <Eye className="w-5 h-5 text-slate-100" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm mb-1 block">Confirmar nova senha</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Repita a nova senha"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="h-12 text-base pr-10 bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-violet-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-90 hover:opacity-100"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5 text-slate-100" />
                  ) : (
                    <Eye className="w-5 h-5 text-slate-100" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full mt-2 h-11 text-base"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando nova senha...
                </>
              ) : (
                'Confirmar nova senha'
              )}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
};

export default ResetPassword;
