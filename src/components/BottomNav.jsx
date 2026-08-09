import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, History, Heart, User } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';

// ✅ 07/08 — barra inferior mobile (Início/Histórico/Favoritos/Perfil),
// pedida pelo Leandro (referência: print do app "Dramio"). Testada com
// tesagencia antes; liberada geral pra todo usuário logado em 07/08.
const TABS = [
  { to: '/dashboard', label: 'Início', Icon: Home, match: (path) => path === '/' || path === '/dashboard' },
  { to: '/historico', label: 'Histórico', Icon: History, match: (path) => path.startsWith('/historico') },
  { to: '/favoritos', label: 'Favoritos', Icon: Heart, match: (path) => path.startsWith('/favoritos') },
  { to: '/minha-conta', label: 'Perfil', Icon: User, match: (path) => path.startsWith('/minha-conta') },
];

export default function BottomNav() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  const enabled = isAuthenticated;

  // Esconde no player (não sobrepor os controles do vídeo)
  const isPlayerRoute = location.pathname.includes('/watch');
  // Esconde nas páginas /admin (têm o próprio AdminTabs) — sem isso ela
  // sobrepõe o campo de resposta no /admin/dora no mobile.
  const isAdminRoute = location.pathname.startsWith('/admin');
  const visible = enabled && !isPlayerRoute && !isAdminRoute;

  // Publica a altura pra outros elementos fixos (Dora chat, InstallAppBanner)
  // não ficarem escondidos atrás da barra — mesmo padrão do InstallAppBanner.
  useEffect(() => {
    // ✅ 07/08: o padding extra pra "área segura" (home indicator) tava
    // sobrando como uma faixa preta vazia embaixo dos ícones em telas sem
    // esse recurso (achado pelo Leandro, print mostrando o espaço morto).
    // Removido — barra fixa de 64px, sem padding a mais.
    document.documentElement.style.setProperty(
      '--dp-bottom-nav-h',
      visible ? '64px' : '0px'
    );
    return () =>
      document.documentElement.style.setProperty('--dp-bottom-nav-h', '0px');
  }, [visible]);

  if (!visible) return null;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-[9980] h-16 bg-slate-950/95 backdrop-blur-sm border-t border-slate-800 flex items-stretch">
      {TABS.map(({ to, label, Icon, match }) => {
        const active = match(location.pathname);
        return (
          <NavLink
            key={to}
            to={to}
            className="flex-1 flex flex-col items-center justify-center gap-1"
          >
            <Icon
              className={`w-5 h-5 ${active ? 'text-purple-400' : 'text-slate-500'}`}
              strokeWidth={active ? 2.5 : 2}
            />
            <span
              className={`text-[11px] leading-none ${active ? 'text-purple-400 font-medium' : 'text-slate-500'}`}
            >
              {label}
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
