import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Eye, EyeOff } from 'lucide-react';

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [checkingLink, setCheckingLink] = useState(true);
  const [validLink, setValidLink] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false); // controla olhinho

  // Verifica se o usuário veio de um link de recuperação válido
  useEffect(() => {
    const checkRecoverySession = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data?.user) {
          setValidLink(false);
        } else {
          setValidLink(true);
        }
      } catch (err) {
        console.error('Erro ao verificar sessão de recuperação:', err);
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

      const { error } = await supabase.auth.updateUser({
        password,
      });

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

  // Enquanto verifica se existe sessão de recuperação
  if (checkingLink) {
    return (
      <>
        <Helmet>
          <title>Redefinir senha | DoramasPlus</title>
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

  // Se não tiver sessão válida, mostra mensagem de link inválido/expirado
  if (!validLink) {
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
              Solicite uma nova recuperação de senha na tela de login.
              Por segurança, cada link só pode ser usado por um tempo limitado.
            </p>
            <Button
              className="w-full"
              onClick={() => navigate('/login')}
            >
              Voltar para o login
            </Button>
          </div>
        </div>
      </>
    );
  }

  // Tela normal de redefinição de senha
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