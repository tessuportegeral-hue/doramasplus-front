// src/App.jsx
// ============================================================
// (LINHAS EXTRAS) Comentários adicionados APENAS pra forçar diff
// Não muda lógica / rotas / auth / nada do funcionamento.
// ============================================================

import React, { useEffect, Suspense, lazy } from 'react';
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
import { AuthProvider, useAuth } from '@/contexts/SupabaseAuthContext';
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
// ✅ 13/08 (INP, dose fina) — o searchQuery mora no App: cada tecla
// (debounced) re-renderizava o App INTEIRO, e com ele a rota atual — no
// /watch isso era um commit de 1,2-1,6s (LoAF pós-29b1b033: os chunks
// restantes do scheduler eram quase todos "digitou na busca estando no
// player/detalhe"). Com o shell memoizado (zero props), o re-render do App
// não desce mais pra essas páginas pesadas; mudança de rota/params continua
// funcionando normal porque vem por CONTEXTO do React Router, não por prop.
// ✅ 19/08 (INP round 38) — TROCA DE ROTA EM DOIS FRAMES. Depois do
// keep-alive, o toque no card ainda era o maior INP da home (p75 416ms,
// presentationDelay 336ms no carimbo bee70990): o MESMO commit que esconde a
// home também montava a página de detalhe INTEIRA, e o navegador só pintava
// no fim. Agora o clique commita só a casca vazia (min-h-screen, pra não
// puxar rodapé pra cima = zero CLS; nós novos não contam como shift) e o
// Detalhe de verdade monta no frame SEGUINTE (rAF duplo — o 1º roda antes da
// pintura do próprio frame, só o 2º garante que uma pintura aconteceu).
// A casca dura ~1 frame e o Detalhe já abre no skeleton próprio dele.
// key diferente por galho (casca vs conteúdo) — ver
// feedback-skeleton-swap-key-phantom-cls: reciclar o nó cobra CLS fantasma.
function DeferredMount({ children }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);
  if (!ready) return <div key="defer-shell" className="min-h-screen" aria-hidden="true" />;
  return <React.Fragment key="defer-content">{children}</React.Fragment>;
}

const MemoDoramaDetail = React.memo(() => (
  <DeferredMount>
    <DoramaDetail />
  </DeferredMount>
));
const MemoDoramaWatch = React.memo(() => <DoramaWatch />);
const AdminEspelho = lazy(() => import('@/pages/AdminEspelho'));

// ✅ 14/08 — Modo Espelho: se o admin ligou a chave pra ESTE usuário
// (live_mirror_flags), o app transmite a tela via Realtime broadcast.
// Custo pra todo o resto do tráfego: 1 consulta leve pós-load+idle; o
// rrweb só é baixado (import dinâmico) se a chave estiver ligada.
const LiveMirrorAgent = () => {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    const kick = () => {
      import('@/lib/liveMirror')
        .then((m) => m.initLiveMirror(user.id))
        .catch(() => {});
    };
    const onIdle = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(kick, { timeout: 2500 });
      } else {
        setTimeout(kick, 2000);
      }
    };
    if (document.readyState === 'complete') onIdle();
    else window.addEventListener('load', onIdle, { once: true });
  }, [user?.id]);
  return null;
};
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
const AdminHome = lazy(() => import('@/pages/AdminHome'));
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

// ✅ 18/08 (INP) — KEEP-ALIVE DA HOME. Telemetria (LoAF, home mobile): o
// toque no card era o maior INP restante — "pointer sem alvo" (o alvo é o
// próprio card, que já não existe quando o Chrome mede) com presentation
// ~250ms: o commit da troca de rota DESMONTAVA a home inteira (centenas de
// nós, ~300 imagens, efeitos) e montava o detalhe no mesmo frame — commit
// não é interrompível nem com startTransition. Agora a home fica MONTADA e
// escondida (`hidden` = display:none, zero layout) enquanto a pessoa lê o
// detalhe: o toque só esconde um nó e o detalhe monta como nó novo. Bônus:
// "voltar" é instantâneo (sem refetch, sem skeleton, sem CLS) e restaura a
// rolagem exata. No PLAYER (/watch) a home é desmontada — vídeo em celular
// fraco precisa da memória; o caminho watch→voltar remonta como hoje.
const HOME_PATHS = new Set(['/', '/dashboard']);
function HomeKeepAlive() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const isHome = HOME_PATHS.has(pathname);
  const isWatch = /^\/dorama\/[^/]+\/watch\/?$/.test(pathname);
  const [mounted, setMounted] = React.useState(isHome);
  const savedScrollRef = React.useRef(0);
  const wasHomeRef = React.useRef(isHome);
  const isHomeRef = React.useRef(isHome);

  // Rolagem da home é gravada por listener ENQUANTO ela está visível (com
  // trava por ref): o ScrollToTopOnNavigate roda antes deste efeito no
  // mesmo commit e zera o scroll ao sair — ler window.scrollY na saída
  // devolveria 0. A trava (isHomeRef) vira false no layout effect abaixo,
  // antes de qualquer evento de scroll do scrollTo(0,0) chegar.
  React.useEffect(() => {
    const onScroll = () => {
      if (isHomeRef.current) savedScrollRef.current = window.scrollY || 0;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  React.useLayoutEffect(() => {
    isHomeRef.current = isHome;
    if (isHome) {
      if (!mounted) setMounted(true);
      // Voltou (POP) pra home viva: restaura a rolagem de onde saiu. Entrada
      // nova (PUSH, ex.: toque no logo) o ScrollToTopOnNavigate já leva a 0.
      if (mounted && !wasHomeRef.current && navType === 'POP') {
        window.scrollTo(0, savedScrollRef.current || 0);
      }
    }
    if (isWatch && mounted) setMounted(false);
    wasHomeRef.current = isHome;
  }, [isHome, isWatch, mounted, navType]);

  if (!mounted) return null;
  return (
    <div hidden={!isHome}>
      <Dashboard />
    </div>
  );
}

// Fallback mínimo enquanto o chunk da rota baixa (code-splitting).
// Cada página já tem seu próprio skeleton pro loading dos DADOS; isso aqui
// só cobre o instante de download do JS, então fica neutro (sem "piscar"
// texto/spinner) pra não competir com o skeleton da própria página.
function RouteFallback() {
  return <div className="min-h-screen bg-slate-950" />;
}

function App() {
  // ✅ 15/08 (INP) — searchQuery saiu daqui pro Dashboard: o App não
  // re-renderiza mais a cada busca (ver comentário no Dashboard.jsx).
  return (
    <>
      <SplashScreen />

      <Helmet>
        <title>DoramasPlus - Doramas Dublados e Legendados Online</title>

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
          <LiveMirrorAgent />
          <DoramasChat />
          <UpdateEmailGate />
          <BottomNav />
          <InstallAppBanner />
          <DeviceGuard>
            {/* ✅ (NOVO) Gate: se estiver logado e sem profiles.phone, trava tudo até salvar */}
            <RequirePhoneGate>
              <Suspense fallback={<RouteFallback />}>
              {/* ✅ 18/08 (INP) — a home vive AQUI (keep-alive), fora do
                  <Routes>: as rotas "/" e "/dashboard" só marcam que é home;
                  quem renderiza o Dashboard é o HomeKeepAlive acima. */}
              <HomeKeepAlive />
              <Routes>
                {/* 🔓 CATÁLOGO PÚBLICO — renderizado pelo HomeKeepAlive */}
                <Route path="/" element={null} />

                {/* ✅ (ADICIONADO) Alias pra evitar bugs de código antigo que manda pra /dashboard */}
                <Route path="/dashboard" element={null} />

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
                <Route path="/dorama/:id" element={<MemoDoramaDetail />} />

                {/* 🎬 PLAYER (gate fica DENTRO da página) */}
                <Route path="/dorama/:id/watch" element={<MemoDoramaWatch />} />

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
                {/* ✅ 19/08 — /admin agora é a HOME do admin (visão geral do
                    dia + pendências), não mais redirect pro Analytics. */}
                <Route
                  path="/admin"
                  element={
                    <AdminRoute>
                      <AdminHome />
                    </AdminRoute>
                  }
                />
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

                {/* ✅ 14/08 — MODO ESPELHO (ver tela do cliente ao vivo) */}
                <Route
                  path="/admin/espelho"
                  element={
                    <AdminRoute>
                      <AdminEspelho />
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
