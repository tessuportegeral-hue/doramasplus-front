import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';

const AdminRoute = ({ children }) => {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();

        if (error || !data?.user) {
          setAllowed(false);
          return;
        }

        const email = data.user.email?.toLowerCase();

        // 🔐 Só esse e-mail pode acessar o painel admin
        if (email === 'tessuportegeral@gmail.com') {
          setAllowed(true);
        } else {
          setAllowed(false);
        }
      } catch (err) {
        console.error('Erro ao verificar admin:', err);
        setAllowed(false);
      } finally {
        setChecking(false);
      }
    };

    checkAdmin();
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-50">
        <Loader2 className="h-8 w-8 animate-spin mb-3" />
        <p className="text-sm text-slate-300">
          Verificando permissão de administrador...
        </p>
      </div>
    );
  }

  // Não está logado ou não é o admin → manda pro login normal
  if (!allowed) {
    return <Navigate to="/login" replace />;
  }

  // Tudo certo → renderiza o painel admin
  return children;
};

export default AdminRoute;