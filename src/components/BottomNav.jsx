import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, History, Heart, User } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';

// ✅ 07/08 — TESTE: barra inferior mobile (Início/Histórico/Favoritos/Perfil)
// pedida pelo Leandro (referência: print do app "Dramio"). Gateada só pro
// tesagencia@gmail.com pra ele ver como fica antes de liberar geral. Quando
// liberar, trocar BOTTOM_NAV_TEST_EMAIL por null (ou remover o gate).
const BOTTOM_NAV_TEST_EMAIL = 'tesagencia@gmail.com';

const TABS = [
  { to: '/dashboard', label: 'Início', Icon: Home, match: (path) => path === '/' || path === '/dashboard' },
  { to: '/historico', label: 'Histórico', Icon: History, match: (path) => path.startsWith('/historico') },
  { to: '/favoritos', label: 'Favoritos', Icon: Heart, match: (path) => path.startsWith('/favoritos') },
  { to: '/minha-conta', label: 'Perfil', Icon: User, match: (path) => path.startsWith('/minha-conta') },
];

export default function BottomNav() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();

  const enabled =
    isAuthenticated && user?.email === BOTTOM_NAV_TEST_EMAIL;

  // Esconde no player (não sobrepor os controles do vídeo)
  const isPlayerRoute = location.pathname.includes('/watch');
  const visible = enabled && !isPlayerRoute;

  // Publica a altura pra outros elementos fixos (Dora chat, InstallAppBanner)
  // não ficarem escondidos atrás da barra — mesmo padrão do InstallAppBanner.
  useEffect(() => {
    // ✅ A altura publicada precisa somar a "área segura" embaixo (home
    // indicator do iPhone) — se não, o padding-bottom do safe-area come
    // espaço de dentro dos 64px fixos e espreme/corta o ícone+texto.
    document.documentElement.style.setProperty(
      '--dp-bottom-nav-h',
      visible ? 'calc(52px + env(safe-area-inset-bottom, 0px))' : '0px'
    );
    return () =>
      document.documentElement.style.setProperty('--dp-bottom-nav-h', '0px');
  }, [visible]);

  if (!visible) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-[9980] bg-slate-950/95 backdrop-blur-sm border-t border-slate-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="h-[52px] flex items-stretch">
        {TABS.map(({ to, label, Icon, match }) => {
          const active = match(location.pathname);
          return (
            <NavLink
              key={to}
              to={to}
              className="flex-1 flex flex-col items-center justify-center gap-0.5"
            >
              <Icon
                className={`w-[18px] h-[18px] ${active ? 'text-purple-400' : 'text-slate-500'}`}
                strokeWidth={active ? 2.5 : 2}
              />
              <span
                className={`text-[10px] leading-none ${active ? 'text-purple-400 font-medium' : 'text-slate-500'}`}
              >
                {label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
