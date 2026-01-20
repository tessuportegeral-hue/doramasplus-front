import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Home, Loader2, AlertTriangle } from 'lucide-react';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!email || !password) {
      setError('Por favor, preencha todos os campos.');
      setLoading(false);
      return;
    }

    try {
      const { data, error: queryError } = await supabase
        .from('admin_users')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (queryError || !data) {
        setError('Credenciais inválidas');
        setLoading(false);
        return;
      }

      if (password === data.senha_hash) {
        localStorage.setItem('isAdmin', 'true');
        navigate('/admin');
      } else {
        setError('Credenciais inválidas');
      }
    } catch (err) {
      setError('Ocorreu um erro. Tente novamente.');
      console.error('Admin login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Login Admin - DoramaStream</title>
      </Helmet>
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-purple-400">Admin Login</h1>
            <p className="text-slate-400 mt-2">Acesso restrito ao painel de controle.</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-slate-900 p-8 rounded-lg shadow-lg border border-slate-800 space-y-6">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-slate-300">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-slate-300">Senha</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {error && (
              <div className="flex items-center text-sm text-red-400 bg-red-900/20 p-2 rounded-md">
                <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </Button>
          </form>

          <div className="text-center mt-6">
            <Link to="/" className="text-sm text-slate-400 hover:text-purple-400 transition-colors inline-flex items-center">
              <Home className="w-4 h-4 mr-1" />
              Voltar para a página inicial
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default AdminLogin;