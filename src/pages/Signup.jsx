import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Play, Mail, Lock, User, ArrowRight, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { signUp } from '@/lib/auth';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';

const Signup = () => {
  const navigate = useNavigate();
  const location = useLocation(); // ✅ (ADICIONADO) pra capturar ?src=
  const { isAuthenticated } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '', // ✅ NOVO
    password: '',
    confirmPassword: ''
  });

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      // ✅ (AJUSTE MÍNIMO) mantém ?src=ads ao redirecionar
      navigate(`/dashboard${location.search ? location.search : ''}`);
    }
  }, [isAuthenticated, navigate, location.search]);

  // ✅ (ADICIONADO) captura o parâmetro src (ex.: ?src=ads) e salva no localStorage
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(location.search);
      const src = (params.get('src') || '').trim().toLowerCase();
      if (src) {
        localStorage.setItem('dp_traffic_src', src);
        localStorage.setItem('dp_traffic_src_ts', String(Date.now()));
      }
    } catch {}
  }, [location.search]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const normalizePhone = (raw) => String(raw || '').replace(/\D/g, '');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast({
        title: 'As senhas não coincidem',
        description: 'Digite a mesma senha nos dois campos.',
        variant: 'destructive',
      });
      return;
    }

    if (formData.password.length < 6) {
      toast({
        title: 'Senha muito curta',
        description: 'A senha deve conter no mínimo 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    // ✅ AGORA OBRIGATÓRIO: valida sempre
    const phoneDigits = normalizePhone(formData.phone);
    if (phoneDigits.length < 10) {
      toast({
        title: 'WhatsApp inválido',
        description: 'Digite seu WhatsApp com DDD. Ex: (11) 99999-9999',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await signUp(formData.email, formData.password, {
        name: formData.name
      });

      if (error) throw error;

      // ✅ salva phone no profile (não quebra o signup se falhar)
      try {
        const userId = data?.user?.id || data?.session?.user?.id || null;
        if (userId && phoneDigits) {
          const { error: phoneErr } = await supabase
            .from('profiles')
            .upsert(
              { id: userId, phone: phoneDigits },
              { onConflict: 'id' }
            );

          if (phoneErr) {
            const msg = String(phoneErr.message || '').toLowerCase();
            const isDup = msg.includes('duplicate') || msg.includes('unique');
            toast({
              title: 'Conta criada, mas WhatsApp não foi salvo',
              description: isDup
                ? 'Esse WhatsApp já está vinculado a outra conta. Você pode entrar e ajustar depois.'
                : 'Você pode entrar e adicionar seu WhatsApp depois.',
              variant: 'destructive',
            });
          }
        }
      } catch {
        // silencioso: não deixa isso atrapalhar criação da conta
      }

      if (data?.session) {
        toast({
          title: 'Conta criada!',
          description: 'Bem-vindo ao DoramasPlus!',
        });

        // ✅ (AJUSTE MÍNIMO) se já logou, mantém ?src=ads ao ir pro dashboard
        navigate(`/dashboard${location.search ? location.search : ''}`);
      } else {
        toast({
          title: 'Conta criada!',
          description: 'Verifique seu e-mail para confirmar sua conta.',
        });
        // ✅ (AJUSTE MÍNIMO) mantém ?src=ads ao ir pro login
        setTimeout(
          () => navigate(`/login${location.search ? location.search : ''}`),
          2000
        );
      }

    } catch (error) {
      toast({
        title: 'Erro ao criar conta',
        description: error.message || 'Não foi possível criar sua conta.',
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Criar Conta - DoramasPlus</title>
        <meta
          name="description"
          content="Crie sua conta DoramasPlus e comece a assistir seus doramas favoritos."
        />
      </Helmet>

      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-12">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md relative z-10"
        >
          <Link to="/" className="flex items-center justify-center space-x-2 mb-8">
            <Play className="w-8 h-8 text-purple-500 fill-purple-500" />
            <span className="text-2xl font-bold text-gradient">DoramasPlus</span>
          </Link>

          <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-slate-800">
            <h1 className="text-3xl font-bold text-white mb-2 text-center">
              Criar Conta
            </h1>
            <p className="text-slate-400 text-center mb-4">
              Comece sua jornada nos doramas hoje mesmo
            </p>

            {/* ✅ MOVIDO PRA CIMA: "Já tem uma conta? Entrar" */}
            <div className="mb-8 text-center">
              <p className="text-slate-400">
                Já tem uma conta?{' '}
                <Link
                  to={`/login${location.search ? location.search : ''}`} // ✅ (AJUSTE MÍNIMO) mantém ?src=ads
                  className="text-purple-400 hover:text-purple-300 font-semibold"
                >
                  Entrar
                </Link>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Nome */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2">
                  Nome completo
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Ex: Maria Almeida"
                    className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg 
                    text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="seuemail@gmail.com"
                    className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg 
                    text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* WhatsApp */}
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-300 mb-2">
                  WhatsApp (DDD)
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="(11) 99999-9999"
                    className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg 
                    text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Usamos seu WhatsApp apenas para avisos e promoções.
                </p>
              </div>

              {/* Senha */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={6}
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Digite sua senha"
                    className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg 
                    text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* Confirmar senha */}
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300 mb-2">
                  Confirmar senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    required
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Repita sua senha"
                    className="w-full pl-10 pr-4 py-3 bg-slate-800 border border-slate-700 rounded-lg 
                    text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              {/* Botão */}
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white py-6 text-lg font-semibold"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Criando...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    Criar Conta
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </span>
                )}
              </Button>
            </form>

            {/* ✅ REMOVIDO DAQUI: bloco "Entrar" (foi movido pra cima) */}
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Signup;
