// src/App.jsx
// ============================================================
// (LINHAS EXTRAS) Comentários adicionados APENAS pra forçar diff
// Não muda lógica / rotas / auth / nada do funcionamento.
// ============================================================

import React, { useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import InstallAppBanner from '@/components/InstallAppBanner';

// ✅ (NOVO) Gate obrigatório do WhatsApp/phone
import RequirePhoneGate from '@/components/RequirePhoneGate';

// ============================================================
// Páginas (mantido exatamente como está)
// ============================================================

// Páginas
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import Dashboard from '@/pages/Dashboard';
import DoramaDetail from '@/pages/DoramaDetail';
import DoramaWatch from '@/pages/DoramaWatch';
import SubscriptionPlans from '@/pages/SubscriptionPlans';
import CheckoutSuccess from '@/pages/CheckoutSuccess';
import CheckoutCanceled from '@/pages/CheckoutCanceled';
import TesteBunny from '@/pages/TesteBunny';
import AdminDoramas from '@/pages/AdminDoramas';
import ProtectedRoute from '@/components/ProtectedRoute';
import ExclusiveDoramas from '@/pages/ExclusiveDoramas';
import NewDoramas from '@/pages/NewDoramas';
import RecommendedDoramas from '@/pages/RecommendedDoramas';
import DubbedDoramas from '@/pages/DubbedDoramas';
import ResetPassword from '@/pages/ResetPassword';

// ✅ (ADICIONADO) Página do vídeo
import ComoFunciona from '@/pages/ComoFunciona';

// Admin
import AdminLogin from '@/pages/AdminLogin';
import AdminAnalytics from '@/pages/AdminAnalytics';
import AdminUsers from '@/pages/AdminUsers';
import AdminRoute from '@/components/AdminRoute';

// ✅ (NOVO) Painel de atendimento
import AdminSupport from '@/pages/AdminSupport';

// Landing
import Landing from '@/pages/Landing';

// ============================================================
// DeviceGuard (mantido exatamente como está)
// ============================================================

// ✅ Guard global: derruba INSTANTÂNEO via Realtime quando outro device entrar
function DeviceGuard({ children }) {
  // ✅ (MUDANÇA MÍNIMA NECESSÁRIA)
  // A lógica antiga de device_id / user_sessions estava quebrando (erro 42703)
  // então aqui fica desativada sem mexer em rotas/auth.
  return children;

  // ------------------------------------------------------------
  // ⚠️ CÓDIGO ANTIGO (DESATIVADO)
  // Se quiser reativar no futuro, primeiro garanta que existe:
  // - tabela public.user_sessions
  // - coluna device_id
  // - policies corretas
  // ------------------------------------------------------------

  /*
  const { user, loading: authLoading } = useAuth();
  const location = useLocation(); // mantido (não removi), mas não uso nas deps
  const navigate = useNavigate();

  const DEVICE_KEY = 'dp_device_id';

  const getStoredDeviceId = () => {
    try {
      return localStorage.getItem(DEVICE_KEY);
    } catch {
      return null;
    }
  };

  const forceLogout = async (reason) => {
    try {
      await supabase.auth.signOut();
    } catch {}
    navigate(`/login?reason=${reason}`, { replace: true });
  };

  useEffect(() => {
    let cancelled = false;
    let channel = null;
    let checkIntervalId = null;
    let heartbeatIntervalId = null;

    const checkOnce = async () => {
      try {
        if (cancelled) return;
        if (authLoading || !user) return;

        const localDeviceId = getStoredDeviceId();
        if (!localDeviceId) {
          await forceLogout('device');
          return;
        }

        const { data, error } = await supabase
          .from('user_sessions')
          .select('device_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error('[single-device] erro ao validar sessão:', error);
          return;
        }

        if (!data?.device_id) return;

        if (data.device_id !== localDeviceId) {
          await forceLogout('other_device');
        }
      } catch (e) {
        console.error('[single-device] exception:', e);
      }
    };

    const setupRealtime = async () => {
      try {
        if (cancelled) return;
        if (authLoading || !user) return;

        // Checa uma vez ao entrar
        await checkOnce();

        // ✅ Realtime: escuta mudanças na sessão do usuário e derruba na HORA
        channel = supabase
          .channel(`user_sessions_${user.id}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'user_sessions',
              filter: `user_id=eq.${user.id}`,
            },
            async (payload) => {
              try {
                if (cancelled) return;

                const localDeviceId = getStoredDeviceId();
                if (!localDeviceId) {
                  await forceLogout('device');
                  return;
                }

                const newRow = payload?.new || null;
                const newDeviceId = newRow?.device_id || null;

                // Se mudou pra outro device, derruba instantâneo
                if (newDeviceId && newDeviceId !== localDeviceId) {
                  await forceLogout('other_device');
                }
              } catch (e) {
                console.error('[single-device] realtime exception:', e);
              }
            }
          )
          .subscribe();

        // ✅ Heartbeat agressivo: mantém sessão "viva"
        heartbeatIntervalId = setInterval(async () => {
          try {
            if (cancelled) return;
            if (authLoading || !user) return;

            const localDeviceId = getStoredDeviceId();
            if (!localDeviceId) return;

            await supabase.from('user_sessions').upsert(
              {
                user_id: user.id,
                device_id: localDeviceId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id' }
            );
          } catch (e) {
            // não derruba por erro de heartbeat pra não travar usuário
          }
        }, 3000);

        // ✅ Fallback rápido
        checkIntervalId = setInterval(checkOnce, 3000);
      } catch (e) {
        console.error('[single-device] setup exception:', e);
      }
    };

    setupRealtime();

    return () => {
      cancelled = true;
      if (checkIntervalId) clearInterval(checkIntervalId);
      if (heartbeatIntervalId) clearInterval(heartbeatIntervalId);
      if (channel) supabase.removeChannel(channel);
    };
  }, [authLoading, user, navigate]);

  return children;
  */
}

// ============================================================
// App (mantido exatamente como está)
// ============================================================

function App() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <>
      <Helmet>
        <title>DoramaStream - Assista seus Dramas Asiáticos Favoritos</title>

        {/* ✅ Meta Domain Verification (Meta Business) */}
        <meta
          name="facebook-domain-verification"
          content="20d3ocykxiy1pg1edp1q37295xlwhm"
        />
      </Helmet>

      <AuthProvider>
        <Router>
          <DeviceGuard>
            {/* ✅ (NOVO) Gate: se estiver logado e sem profiles.phone, trava tudo até salvar */}
            <RequirePhoneGate>
              <Routes>
                {/* 🔓 CATÁLOGO PÚBLICO */}
                <Route
                  path="/"
                  element={
                    <Dashboard
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                    />
                  }
                />

                {/* ✅ (ADICIONADO) Alias pra evitar bugs de código antigo que manda pra /dashboard */}
                <Route
                  path="/dashboard"
                  element={
                    <Dashboard
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                    />
                  }
                />

                {/* ✅ (ADICIONADO) Página do vídeo (conversão) */}
                <Route path="/como-funciona" element={<ComoFunciona />} />

                {/* Landing */}
                <Route path="/landing" element={<Landing />} />

                {/* Auth */}
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/reset-password" element={<ResetPassword />} />

                {/* 🔓 DETALHE DO DORAMA PÚBLICO */}
                <Route path="/dorama/:id" element={<DoramaDetail />} />

                {/* 🎬 PLAYER (gate fica DENTRO da página) */}
                <Route path="/dorama/:id/watch" element={<DoramaWatch />} />

                {/* Categorias (mantidas protegidas, igual antes) */}
                <Route
                  path="/exclusivos"
                  element={
                    <ProtectedRoute>
                      <ExclusiveDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/novos"
                  element={
                    <ProtectedRoute>
                      <NewDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/recomendados"
                  element={
                    <ProtectedRoute>
                      <RecommendedDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dublados"
                  element={
                    <ProtectedRoute>
                      <DubbedDoramas />
                    </ProtectedRoute>
                  }
                />

                {/* ✅ Planos */}
                <Route
                  path="/plans"
                  element={
                    <ProtectedRoute>
                      <SubscriptionPlans />
                    </ProtectedRoute>
                  }
                />

                {/* Checkout */}
                <Route
                  path="/checkout/sucesso"
                  element={
                    <ProtectedRoute>
                      <CheckoutSuccess />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/checkout/cancelado"
                  element={
                    <ProtectedRoute>
                      <CheckoutCanceled />
                    </ProtectedRoute>
                  }
                />

                {/* Outros */}
                <Route path="/teste-bunny" element={<TesteBunny />} />

                {/* ADMIN */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<Navigate to="/admin/analytics" replace />} />
                <Route
                  path="/admin/analytics"
                  element={
                    <AdminRoute>
                      <AdminAnalytics />
                    </AdminRoute>
                  }
                />
                <Route
                  path="/admin/doramas"
                  element={
                    <AdminRoute>
                      <AdminDoramas />
                    </AdminRoute>
                  }
                />
                <Route
                  path="/admin/users"
                  element={
                    <AdminRoute>
                      <AdminUsers />
                    </AdminRoute>
                  }
                />

                {/* ✅ (NOVO) ADMIN SUPPORT */}
                <Route
                  path="/admin/support"
                  element={
                    <AdminRoute>
                      <AdminSupport />
                    </AdminRoute>
                  }
                />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RequirePhoneGate>
          </DeviceGuard>
        </Router>
      </AuthProvider>

      <Toaster />
      <InstallAppBanner />
    </>
  );
}

export default App;
