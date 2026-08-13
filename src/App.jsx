// src/App.jsx
// ============================================================
// (LINHAS EXTRAS) Comentários adicionados APENAS pra forçar diff
// Não muda lógica / rotas / auth / nada do funcionamento.
// ============================================================

import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import { FavoritesProvider } from '@/contexts/FavoritesContext';
import InstallAppBanner from '@/components/InstallAppBanner';
import PushPermissionPrompt from '@/components/PushPermissionPrompt';
import DoramasChat from '@/components/DoramasChat';
import UpdateEmailGate from '@/components/UpdateEmailGate';
import BottomNav from '@/components/BottomNav';
import SplashScreen from '@/components/SplashScreen';
import { supabase } from '@/lib/supabaseClient';
import { noteRouteChange } from '@/lib/reportWebVitals';

// ✅ (NOVO) Gate obrigatório do WhatsApp/phone
import RequirePhoneGate from '@/components/RequirePhoneGate';

// ============================================================
// Páginas — lazy (code-splitting por rota, ver relatório de Core Web
// Vitals de 20/07: um bundle único obrigava toda visita — inclusive
// alguém só lendo a sinopse de um dorama — a baixar/executar o JS do
// admin, checkout, chat etc. Isso sozinho custava ~2,4s de LCP no
// mobile. Guards (ProtectedRoute/AdminRoute) continuam eager, são leves.
// ============================================================

const Login = lazy(() => import('@/pages/Login'));
const Signup = lazy(() => import('@/pages/Signup'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const DoramaDetail = lazy(() => import('@/pages/DoramaDetail'));
const DoramaWatch = lazy(() => import('@/pages/DoramaWatch'));
const SubscriptionPlans = lazy(() => import('@/pages/SubscriptionPlans'));
const CheckoutSuccess = lazy(() => import('@/pages/CheckoutSuccess'));
const CheckoutCanceled = lazy(() => import('@/pages/CheckoutCanceled'));
const TesteBunny = lazy(() => import('@/pages/TesteBunny'));
const AdminDoramas = lazy(() => import('@/pages/AdminDoramas'));
import ProtectedRoute from '@/components/ProtectedRoute';
const ExclusiveDoramas = lazy(() => import('@/pages/ExclusiveDoramas'));
const NewDoramas = lazy(() => import('@/pages/NewDoramas'));
const RecommendedDoramas = lazy(() => import('@/pages/RecommendedDoramas'));
const DubbedDoramas = lazy(() => import('@/pages/DubbedDoramas'));
const BabyDoramas = lazy(() => import('@/pages/BabyDoramas'));
const TabooDoramas = lazy(() => import('@/pages/TabooDoramas'));
const WolfVampireDoramas = lazy(() => import('@/pages/WolfVampireDoramas'));
const BlGlDoramas = lazy(() => import('@/pages/BlGlDoramas'));
const BrasileiroDoramas = lazy(() => import('@/pages/BrasileiroDoramas'));
const AnimeDoramas = lazy(() => import('@/pages/AnimeDoramas'));
const HiddenIdentityDoramas = lazy(() => import('@/pages/HiddenIdentityDoramas'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));

// ✅ (ADICIONADO) Página do vídeo
const ComoFunciona = lazy(() => import('@/pages/ComoFunciona'));

// ✅ Programa de indicação
const Indicar = lazy(() => import('@/pages/Indicar'));

// ✅ Minha Conta
const MinhaConta = lazy(() => import('@/pages/MinhaConta'));

// ✅ Meus Favoritos
const Favoritos = lazy(() => import('@/pages/Favoritos'));

// ✅ (TESTE tesagencia) Meu Histórico
const Historico = lazy(() => import('@/pages/Historico'));

// Admin
const AdminLogin = lazy(() => import('@/pages/AdminLogin'));
const AdminAnalytics = lazy(() => import('@/pages/AdminAnalytics'));
const AdminUsers = lazy(() => import('@/pages/AdminUsers'));
import AdminRoute from '@/components/AdminRoute';

// ✅ (NOVO) Painel de atendimento
const AdminSupport = lazy(() => import('@/pages/AdminSupport'));

// ✅ (NOVO) Painel de monitoramento do Bot de Vendas (1499)
const AdminBotVendas = lazy(() => import('@/pages/AdminBotVendas'));

// ✅ (NOVO) Painel de monitoramento/resposta da Dora (chat do site)
const AdminDora = lazy(() => import('@/pages/AdminDora'));

// ✅ (NOVO) Disparo manual de push pra todos os assinantes
const AdminPush = lazy(() => import('@/pages/AdminPush'));

// Landing
const Landing = lazy(() => import('@/pages/Landing'));
const Privacidade = lazy(() => import('@/pages/Privacidade'));

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

// ✅ Garante que o link de recuperação de senha sempre caia em /reset-password,
// mesmo quando o Supabase faz fallback para a Site URL (geralmente o "/" do app).
function PasswordRecoveryRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // 1) Se ainda existir o hash de recuperação na URL e não estamos em /reset-password,
    //    força reload preservando o hash para o client do Supabase processar lá.
    const hash = window.location.hash || '';
    const hasRecoveryHash =
      hash.includes('type=recovery') || hash.includes('access_token');
    if (hasRecoveryHash && location.pathname !== '/reset-password') {
      window.location.replace(
        '/reset-password' + window.location.search + hash
      );
      return;
    }

    // 2) Se o client já processou o hash e disparou PASSWORD_RECOVERY,
    //    redireciona pra /reset-password com flag explícita.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === 'PASSWORD_RECOVERY' &&
        window.location.pathname !== '/reset-password'
      ) {
        navigate('/reset-password?recovery=1', { replace: true });
      }
    });

    return () => sub?.subscription?.unsubscribe?.();
  }, [navigate, location.pathname]);

  return null;
}

function TrafficSourceTracker() {
  const location = useLocation();
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

      // ===== src (first-touch, TTL 7 dias) =====
      const src = (params.get('src') || '').trim().toLowerCase();
      if (src) {
        const existing = (localStorage.getItem('dp_traffic_src') || '').trim().toLowerCase();
        const ts = Number(localStorage.getItem('dp_traffic_src_ts') || '0');
        const isFresh = ts && Date.now() - ts < SEVEN_DAYS;
        if (!(existing && isFresh)) {
          localStorage.setItem('dp_traffic_src', src);
          localStorage.setItem('dp_traffic_src_ts', String(Date.now()));
          sessionStorage.setItem('dp_traffic_src', src);
        }
      }

      // ===== UTMs (first-touch, TTL 7 dias por campo) =====
      const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
      for (const key of utmKeys) {
        const val = (params.get(key) || '').trim();
        if (!val) continue;
        const storageKey = `dp_${key}`;
        const tsKey = `dp_${key}_ts`;
        const existing = (localStorage.getItem(storageKey) || '').trim();
        const ts = Number(localStorage.getItem(tsKey) || '0');
        const isFresh = ts && Date.now() - ts < SEVEN_DAYS;
        if (existing && isFresh) continue;
        localStorage.setItem(storageKey, val);
        localStorage.setItem(tsKey, String(Date.now()));
      }

      // ===== ref (indicação) — captura global de fallback =====
      // Garante que o ?ref= seja salvo mesmo que a pessoa caia primeiro em
      // outra rota antes de chegar no /cadastro. O Signup também captura,
      // então aqui é só um seguro. Last-touch (sobrescreve), igual ao Signup.
      const ref = (params.get('ref') || '').trim();
      if (ref) {
        localStorage.setItem('doramasplus_ref', ref);
      }

      // ===== fbclid (first-touch, cookie com 7 dias + localStorage como fallback) =====
      const fbclid = (params.get('fbclid') || '').trim();
      if (fbclid) {
        // Cookie com 7 dias de validade.
        // Em producao usa Domain=.doramasplus.com.br pra compartilhar entre apex e www.
        try {
          const isDoramasplus = /(^|\.)doramasplus\.com\.br$/i.test(window.location.hostname);
          const domainAttr = isDoramasplus ? '; Domain=.doramasplus.com.br' : '';
          document.cookie = `dp_fbclid=${fbclid}; max-age=${7 * 24 * 60 * 60}; path=/; SameSite=Lax${domainAttr}`;
        } catch {}
        const existing = (localStorage.getItem('dp_fbclid') || '').trim();
        if (!existing) {
          localStorage.setItem('dp_fbclid', fbclid);
        }
      }
    } catch {}
  }, [location.search]);
  return null;
}

// ============================================================
// App (mantido exatamente como está)
// ============================================================

// ✅ 12/08 — scroll pro topo ao entrar numa página NOVA (PUSH). Antes não
// existia scroll-to-top nenhum: quem tocava num dorama com a home rolada
// 2000px aterrissava no MEIO da página nova, e a troca de conteúdo naquela
// posição contava como CLS gigante da página de entrada (telemetria:
// shifts aos 40-80s de sessão). Voltar (POP) fica como está, preservando
// a posição — comportamento esperado de "voltar".
function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const prevPathRef = React.useRef(pathname);
  React.useLayoutEffect(() => {
    // ✅ 12/08 — avisa a telemetria de cada troca de rota (pra cruzar com o
    // horário dos shifts de CLS e provar/refutar que o CLS é a navegação)
    if (prevPathRef.current !== pathname) {
      noteRouteChange(prevPathRef.current, pathname);
      // ✅ 12/08 — também avisa o resto do app (PushPermissionPrompt usa
      // "saiu do /watch" como hora certa de pedir permissão de push)
      try {
        window.dispatchEvent(
          new CustomEvent('dp:routechange', {
            detail: { from: prevPathRef.current, to: pathname },
          })
        );
      } catch {
        /* nunca quebra a navegação */
      }
      prevPathRef.current = pathname;
    }
    if (navType !== 'POP') {
      window.scrollTo(0, 0);
    }
  }, [pathname, navType]);
  return null;
}

// ✅ 12/08 — pré-carrega os chunks das 2 rotas mais navegadas assim que o
// navegador ficar ocioso. No celular lento, tocar num dorama SEM o chunk em
// cache = troca de página >500ms depois do toque = o Chrome conta a
// desmontagem da home como CLS. Com o chunk quente, a troca é imediata
// (dentro da janela de 500ms pós-toque, que o CLS ignora).
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    const warm = () => {
      import('@/pages/DoramaDetail');
      import('@/pages/DoramaWatch');
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(warm, { timeout: 5000 });
    } else {
      setTimeout(warm, 3000);
    }
  });
}

// Fallback mínimo enquanto o chunk da rota baixa (code-splitting).
// Cada página já tem seu próprio skeleton pro loading dos DADOS; isso aqui
// só cobre o instante de download do JS, então fica neutro (sem "piscar"
// texto/spinner) pra não competir com o skeleton da própria página.
function RouteFallback() {
  return <div className="min-h-screen bg-slate-950" />;
}

function App() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <>
      <SplashScreen />

      <Helmet>
        <title>DoramaStream - Assista seus Dramas Asiáticos Favoritos</title>

        {/* ✅ Meta Domain Verification (Meta Business) */}
        <meta
          name="facebook-domain-verification"
          content="20d3ocykxiy1pg1edp1q37295xlwhm"
        />
      </Helmet>

      <AuthProvider>
        <FavoritesProvider>
        {/* ✅ 13/08 (INP) — v7_startTransition: troca de rota vira transition
            interrompível. O toque em card/menu disparava um render síncrono da
            rota nova que segurava o frame (presentationDelay ~260-1100ms na
            telemetria); em transition o React pinta o feedback do toque antes
            e o render pesado cede a vez pra input novo. */}
        <Router future={{ v7_startTransition: true }}>
          <ScrollToTopOnNavigate />
          <PasswordRecoveryRedirect />
          <TrafficSourceTracker />
          <DoramasChat />
          <UpdateEmailGate />
          <BottomNav />
          <InstallAppBanner />
          <DeviceGuard>
            {/* ✅ (NOVO) Gate: se estiver logado e sem profiles.phone, trava tudo até salvar */}
            <RequirePhoneGate>
              <Suspense fallback={<RouteFallback />}>
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

                {/* Política de Privacidade (pública) */}
                <Route path="/privacidade" element={<Privacidade />} />

                {/* Auth */}
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/cadastro" element={<Signup />} />
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
                <Route
                  path="/gravidez-e-bebe"
                  element={
                    <ProtectedRoute>
                      <BabyDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/relacionamento-tabu"
                  element={
                    <ProtectedRoute>
                      <TabooDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/lobos-e-vampiros"
                  element={
                    <ProtectedRoute>
                      <WolfVampireDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/bl-gl"
                  element={
                    <ProtectedRoute>
                      <BlGlDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/brasileiros"
                  element={
                    <ProtectedRoute>
                      <BrasileiroDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/animes"
                  element={
                    <ProtectedRoute>
                      <AnimeDoramas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/identidade-escondida"
                  element={
                    <ProtectedRoute>
                      <HiddenIdentityDoramas />
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

                {/* ✅ Programa de indicação */}
                <Route
                  path="/indicar"
                  element={
                    <ProtectedRoute>
                      <Indicar />
                    </ProtectedRoute>
                  }
                />

                {/* ✅ Minha Conta */}
                <Route
                  path="/minha-conta"
                  element={
                    <ProtectedRoute>
                      <MinhaConta />
                    </ProtectedRoute>
                  }
                />

                {/* ✅ Meus Favoritos */}
                <Route
                  path="/favoritos"
                  element={
                    <ProtectedRoute>
                      <Favoritos />
                    </ProtectedRoute>
                  }
                />

                {/* ✅ (TESTE tesagencia) Meu Histórico */}
                <Route
                  path="/historico"
                  element={
                    <ProtectedRoute>
                      <Historico />
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

                {/* ✅ (NOVO) ADMIN BOT DE VENDAS (1499) */}
                <Route
                  path="/admin/bot-vendas"
                  element={
                    <AdminRoute>
                      <AdminBotVendas />
                    </AdminRoute>
                  }
                />

                {/* ✅ (NOVO) ADMIN DORA (chat do site) */}
                <Route
                  path="/admin/dora"
                  element={
                    <AdminRoute>
                      <AdminDora />
                    </AdminRoute>
                  }
                />

                {/* ✅ (NOVO) ADMIN PUSH (disparo manual pra assinantes) */}
                <Route
                  path="/admin/push"
                  element={
                    <AdminRoute>
                      <AdminPush />
                    </AdminRoute>
                  }
                />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </Suspense>
            </RequirePhoneGate>
          </DeviceGuard>
        </Router>
        </FavoritesProvider>
      </AuthProvider>

      <Toaster />
      <PushPermissionPrompt />
    </>
  );
}

export default App;
