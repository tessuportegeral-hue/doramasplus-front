import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import PedirDoramaPopover from '@/components/PedirDoramaPopover';
import {
  User,
  LogOut,
  Menu,
  X,
  Star,
  Globe,
  ChevronDown,
  Search,
  Settings,
  CreditCard,
  Calendar,
  AlertTriangle,
  ArrowRight,
  Baby,
  HeartHandshake,
  Eye,
  Sparkles,
  Heart,
  Send,
  Moon,
  Flag,
  Tv,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

const Navbar = ({ searchQuery = '', setSearchQuery = null }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, isAuthenticated } = useAuth();

  const ADMIN_EMAIL = 'tessuportegeral@gmail.com';
  const isAdmin = user?.email === ADMIN_EMAIL;

  // ✅ 07/08 — logo com o "D" em gradiente/texto branco e menu hambúrguer
  // mobile só com categorias (o resto já está na barra inferior/Perfil).
  // Testado com tesagencia antes; liberado geral pra todo usuário logado.
  const showBottomNav = isAuthenticated;

  // ✅ 07/08 — achado na varredura: a faixa vermelha de renovação (acima)
  // muda a altura real do nav fixo, e o "respiro" do topo do Dashboard
  // (compacto) tinha um valor fixo que não cobria esse caso — conteúdo
  // podia renderizar embaixo do nav quando a faixa aparecesse. Em vez de
  // chutar um número fixo grande o suficiente, o nav mede a própria altura
  // de verdade (ResizeObserver) e publica numa CSS var, mesmo padrão já
  // usado pro InstallAppBanner/BottomNav.
  const navRef = useRef(null);
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty('--dp-navbar-h', `${el.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ✅ META PIXEL ID (CORRIGIDO)
  const META_PIXEL_ID = '1424314778637167';

  // ✅ Link dos planos (pra renovar)
  const PLANS_URL = 'https://doramasplus.com.br/plans';

  // 🔔 assinatura
  const [subLoading, setSubLoading] = useState(false);
  const [subscription, setSubscription] = useState(null);

  // 📱 telefone do profiles (pra Advanced Matching do Pixel)
  const [userPhone, setUserPhone] = useState('');

  useEffect(() => {
    if (!user) { setUserPhone(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('phone')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (!error && data?.phone) {
          setUserPhone(String(data.phone).trim());
        } else {
          setUserPhone('');
        }
      } catch {
        if (!cancelled) setUserPhone('');
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ✅ META PIXEL — carrega 1x, re-init quando email/telefone mudarem (Advanced Matching)
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!META_PIXEL_ID) return;

      // Carrega o script 1x
      if (!window.fbq) {
        (function (f, b, e, v, n, t, s) {
          if (f.fbq) return;
          n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
          };
          if (!f._fbq) f._fbq = n;
          n.push = n;
          n.loaded = true;
          n.version = '2.0';
          n.queue = [];
          t = b.createElement(e);
          t.async = true;
          t.src = v;
          t.id = 'dp-fb-pixel';
          s = b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t, s);
        })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      }

      // Advanced Matching: o Pixel hasheia em/ph automaticamente.
      // Re-inicializa quando email ou telefone mudarem (ex.: usuário acabou de logar).
      const email = user?.email ? String(user.email).trim().toLowerCase() : '';
      const phone = userPhone || '';
      const initKey = `${email}|${phone}`;

      if (window.__dp_fb_init_key !== initKey) {
        const advanced = {};
        if (email) advanced.em = email;
        if (phone) advanced.ph = phone;

        if (Object.keys(advanced).length > 0) {
          window.fbq('init', META_PIXEL_ID, advanced);
        } else {
          window.fbq('init', META_PIXEL_ID);
        }
        window.__dp_fb_init_key = initKey;
      }

      // PageView em SPA (a cada troca de rota)
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'PageView');
      }
    } catch {
      // não quebra nada
    }
  }, [META_PIXEL_ID, location.pathname, user?.email, userPhone]);

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      return;
    }

    const fetchSub = async () => {
      try {
        setSubLoading(true);

        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        setSubscription(data || null);
      } catch (err) {
        console.error('Erro ao carregar assinatura no menu:', err);
        setSubscription(null);
      } finally {
        setSubLoading(false);
      }
    };

    fetchSub();
  }, [user]);

  const formatDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const getDateFromSubscription = (sub) => {
    if (!sub) return null;
    return (
      sub.current_period_end ||
      sub.expires_at ||
      sub.current_period_end_at ||
      sub.period_end ||
      null
    );
  };

  const nextBillingRaw = getDateFromSubscription(subscription);
  const nextBilling = formatDate(nextBillingRaw) || null;

  const planName =
    subscription?.plan_name ||
    subscription?.price_nickname ||
    null;

  const statusLabel = subscription?.status || null;

  // ✅ dias restantes
  const daysLeft = useMemo(() => {
    if (!nextBillingRaw) return null;
    const end = new Date(nextBillingRaw);
    if (Number.isNaN(end.getTime())) return null;

    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  }, [nextBillingRaw]);

  const showRenewWarning = useMemo(() => {
    if (!isAuthenticated || !subscription) return false;
    if (subLoading) return false;
    if (daysLeft === null) return false;
    return daysLeft <= 5;
  }, [isAuthenticated, subscription, subLoading, daysLeft]);

  const warningText = useMemo(() => {
    if (!showRenewWarning) return '';
    if (daysLeft <= 0) return 'Sua assinatura venceu. Renove agora para continuar assistindo.';
    if (daysLeft === 1) return 'Falta 1 dia para vencer sua assinatura. Renove agora.';
    return `Faltam ${daysLeft} dias para vencer sua assinatura. Renove agora.`;
  }, [showRenewWarning, daysLeft]);

  const handleGoPlans = () => {
    window.location.href = PLANS_URL;
  };

  const handleLogout = async () => {
    try {
      setMobileMenuOpen(false);
      await supabase.auth.signOut();

      toast({
        title: 'Desconectado com sucesso',
        description: 'Até logo!'
      });

      navigate('/');
      setTimeout(() => window.location.reload(), 150);
    } catch (err) {
      toast({
        title: 'Erro ao desconectar',
        description: err.message,
        variant: 'destructive'
      });
    }
  };

  // ✅ rolagem pras seções que EXISTEM no Dashboard/Catálogo
  const scrollToSection = (sectionId) => {
    const scrollAction = () => {
      if (sectionId === 'top') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const el = document.getElementById(sectionId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    };

    // ✅ aceita /dashboard e /dashboard/…
    if (!location.pathname.startsWith('/dashboard')) {
      navigate('/dashboard');
      setTimeout(scrollAction, 450);
    } else {
      scrollAction();
    }

    setMobileMenuOpen(false);
  };

  const displayName = user?.user_metadata?.name || user?.email || 'Usuário';

  // ✅ A BUSCA aparece sempre que essa página realmente controla a busca
  const showSearch = isAuthenticated && typeof setSearchQuery === 'function';

  // ✅ (NOVO) botão "Assine agora" quando NÃO tem assinatura ativa
  const showSubscribeNow = useMemo(() => {
    if (!isAuthenticated) return false;
    if (subLoading) return false;

    // sem assinatura
    if (!subscription) return true;

    const status = String(subscription?.status || '').toLowerCase();

    // se não está active/trialing, oferece assinar
    if (status !== 'active' && status !== 'trialing') return true;

    // se venceu (dias <= 0), oferece assinar
    if (typeof daysLeft === 'number' && daysLeft <= 0) return true;

    // se não tem data válida, mas tá "active", não mostra (pra evitar falso positivo)
    return false;
  }, [isAuthenticated, subLoading, subscription, daysLeft]);

  return (
    <>
    <nav ref={navRef} className="fixed top-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800">
      {/* ✅ aviso topo */}
      {showRenewWarning && (
        <div className="bg-red-600/95 border-b border-red-400/30">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-1.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <p className="text-[12px] sm:text-sm leading-tight truncate">
                  <span className="font-semibold">Atenção:</span> {warningText}
                  {nextBilling && (
                    <span className="hidden sm:inline opacity-90">
                      {' '} (Vencimento: <span className="font-semibold">{nextBilling}</span>)
                    </span>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={handleGoPlans}
                className="flex-shrink-0 inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 border border-white/25 rounded-full px-3 py-1 text-[12px] sm:text-sm font-semibold transition"
              >
                Renovar <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {nextBilling && (
              <p className="sm:hidden mt-1 text-[11px] opacity-90">
                Vencimento: <span className="font-semibold">{nextBilling}</span>
              </p>
            )}
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link
            to={isAuthenticated ? '/dashboard' : '/'}
            className="flex items-center space-x-2 group"
          >
            <motion.div
              whileHover={{ scale: 1.1, rotate: 360 }}
              transition={{ duration: 0.3 }}
            >
              {/* ✅ 07/08 — TESTE: pro tesagencia, inverte as cores — o "D"
                  ganha o gradiente (via CSS mask, já que é um PNG) e o
                  texto vira branco sólido */}
              {showBottomNav ? (
                <div
                  className="w-8 h-8 bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400"
                  style={{
                    WebkitMaskImage: 'url(/logo-d-mark.png)',
                    WebkitMaskSize: 'contain',
                    WebkitMaskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskImage: 'url(/logo-d-mark.png)',
                    maskSize: 'contain',
                    maskRepeat: 'no-repeat',
                    maskPosition: 'center',
                  }}
                />
              ) : (
                <img src="/logo-d-mark.png" alt="DoramasPlus" className="w-8 h-8 object-contain" />
              )}
            </motion.div>
            <span className={showBottomNav ? 'text-xl font-bold text-white' : 'text-xl font-bold text-gradient'}>DoramasPlus</span>
          </Link>

          {/* ✅ BUSCA no lugar certo (entre logo e categorias) */}
          <div className="flex-1 flex justify-center px-4">
            {showSearch && (
              <div className="w-full max-w-sm">
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                  <Search className="w-4 h-4 text-white/50" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar..."
                    className="bg-transparent border-none outline-none text-sm text-white/90 w-full placeholder:text-white/50"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="hidden md:flex items-center space-x-4">
            {isAuthenticated ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="text-slate-300 hover:text-white hover:bg-transparent border border-slate-700 hover:border-slate-600 rounded-full h-9 px-4 flex items-center gap-1 transition"
                    >
                      Categorias <ChevronDown className="w-4 h-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent className="bg-slate-900 border-slate-800 text-slate-200 w-60 p-2">
                    <DropdownMenuItem onClick={() => scrollToSection('top')}>
                      <Sparkles className="w-4 h-4 text-purple-300" />
                      <span className="ml-2">Início</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/novos')}>
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span className="ml-2">Novos Lançamentos</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/dublados')}>
                      <Globe className="w-4 h-4 text-blue-400" />
                      <span className="ml-2">Séries Dubladas</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/gravidez-e-bebe')}>
                      <Baby className="w-4 h-4 text-pink-400" />
                      <span className="ml-2">Bebês e Gravidezes</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/relacionamento-tabu')}>
                      <HeartHandshake className="w-4 h-4 text-red-400" />
                      <span className="ml-2">Relacionamento Tabu</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/lobos-e-vampiros')}>
                      <Moon className="w-4 h-4 text-indigo-400" />
                      <span className="ml-2">Lobos & Vampiros</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/bl-gl')}>
                      <Heart className="w-4 h-4 text-rose-400" />
                      <span className="ml-2">BL & GL</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/brasileiros')}>
                      <Flag className="w-4 h-4 text-emerald-400" />
                      <span className="ml-2">Brasileiros</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/animes')}>
                      <Tv className="w-4 h-4 text-cyan-400" />
                      <span className="ml-2">Animes</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/identidade-escondida')}>
                      <Eye className="w-4 h-4 text-teal-400" />
                      <span className="ml-2">Identidade Escondida</span>
                    </DropdownMenuItem>

                    <DropdownMenuItem onClick={() => navigate('/recomendados')}>
                      <Star className="w-4 h-4 text-amber-400" />
                      <span className="ml-2">Recomendados Para Você</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="ghost"
                  onClick={() => navigate('/favoritos')}
                  className={`hover:bg-transparent border rounded-full h-9 px-4 flex items-center gap-1.5 transition ${
                    location.pathname === '/favoritos'
                      ? 'text-red-400 border-red-500/40 hover:text-red-300 hover:border-red-500/60'
                      : 'text-slate-300 border-slate-700 hover:text-white hover:border-slate-600'
                  }`}
                >
                  <Heart className="w-4 h-4" />
                  Favoritos
                </Button>

                <PedirDoramaPopover />

                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="text-slate-300 hover:text-white hover:bg-transparent border border-slate-700 hover:border-slate-600 rounded-full w-9 h-9 p-0 flex items-center justify-center transition"
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-slate-900 border-slate-800 text-slate-200 w-56 p-2">
                      <DropdownMenuItem onClick={() => navigate('/admin/analytics')}>
                        Painel Admin
                      </DropdownMenuItem>

                      {/* ✅ ADICIONADO: Admin Support (WhatsApp) */}
                      <DropdownMenuItem onClick={() => navigate('/admin/support')}>
                        Atendimento WhatsApp
                      </DropdownMenuItem>

                      {/* ✅ ADICIONADO: Admin Dora (chat do site) */}
                      <DropdownMenuItem onClick={() => navigate('/admin/dora')}>
                        Dora (chat do site)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <div className="flex items-center pl-4 border-l border-slate-700">
                  {showSubscribeNow && (
                    <button
                      type="button"
                      onClick={handleGoPlans}
                      className="mr-3 inline-flex items-center gap-2 text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition"
                    >
                      Assine agora <ArrowRight className="w-4 h-4" />
                    </button>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-2 px-2 py-1.5 rounded-full border border-slate-700 hover:border-slate-600 hover:bg-slate-800/60 transition group"
                      >
                        <div className="w-8 h-8 rounded-full bg-purple-500/15 border border-purple-500/30 flex items-center justify-center">
                          <User className="w-4 h-4 text-purple-300" />
                        </div>
                        <span className="text-sm text-slate-200 max-w-[140px] truncate">
                          {displayName}
                        </span>
                        <ChevronDown className="w-4 h-4 text-slate-400 group-data-[state=open]:rotate-180 transition" />
                      </button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent
                      align="end"
                      sideOffset={8}
                      className="bg-slate-900 border-slate-800 text-slate-200 w-72 p-2"
                    >
                      {/* Header */}
                      <div className="px-2 py-2.5 border-b border-slate-800 mb-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {displayName}
                        </p>
                        {user?.email && (
                          <p className="text-xs text-slate-400 truncate">
                            {user.email}
                          </p>
                        )}

                        <div className="mt-2 flex items-center justify-between gap-2">
                          {subLoading ? (
                            <span className="text-xs text-slate-500">
                              Carregando assinatura…
                            </span>
                          ) : !subscription ? (
                            <span className="text-xs text-amber-300">
                              Sem assinatura ativa
                            </span>
                          ) : (
                            <span
                              className={
                                'text-xs font-semibold inline-flex items-center gap-1 ' +
                                (String(statusLabel || '').toLowerCase() === 'active'
                                  ? 'text-emerald-300'
                                  : 'text-amber-300')
                              }
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              {statusLabel || 'inativa'}
                            </span>
                          )}

                          {nextBilling && (
                            <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {nextBilling}
                            </span>
                          )}
                        </div>
                      </div>

                      <DropdownMenuItem
                        onClick={() => navigate('/minha-conta')}
                        className="cursor-pointer focus:bg-slate-800"
                      >
                        <Settings className="w-4 h-4 text-purple-300" />
                        <span className="ml-2">Configurações</span>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator className="bg-slate-800" />

                      <DropdownMenuItem
                        onClick={handleLogout}
                        className="cursor-pointer focus:bg-slate-800"
                      >
                        <LogOut className="w-4 h-4 text-slate-300" />
                        <span className="ml-2">Sair</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </>
            ) : (
              <>
                <Link to="/login"><Button variant="ghost">Entrar</Button></Link>
                <Link to="/signup">
                  <Button className="bg-purple-600 hover:bg-purple-700">Cadastrar</Button>
                </Link>
              </>
            )}
          </div>

          {/* ✅ ÚNICA ALTERAÇÃO: no mobile, mostrar Entrar/Cadastrar no topo */}
          <div className="md:hidden flex items-center gap-2">
            {!isAuthenticated && (
              <>
                <Link to="/login">
                  <Button variant="ghost" className="h-9 px-3">
                    Entrar
                  </Button>
                </Link>
                <Link to="/signup">
                  <Button className="h-9 px-3 bg-purple-600 hover:bg-purple-700">
                    Cadastrar
                  </Button>
                </Link>
              </>
            )}

            <button
              className="text-slate-300 hover:text-white"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-800 bg-slate-950/98">
          <div className="container mx-auto px-4 py-3 space-y-4">
            {isAuthenticated ? (
              <>
                <div className="flex flex-col gap-2">
                  {/* ✅ 07/08 — TESTE: pro tesagencia, esses 3 já estão na
                      barra inferior/Perfil, então somem daqui — hambúrguer
                      fica só com categorias */}
                  {!showBottomNav && (
                    <>
                      <button
                        onClick={() => { setMobileMenuOpen(false); navigate('/favoritos'); }}
                        className="flex items-center gap-2 text-slate-200 text-sm font-semibold"
                      >
                        <Heart className="w-4 h-4 text-red-400" /> Favoritos
                      </button>
                      <button
                        onClick={() => { setMobileMenuOpen(false); navigate('/minha-conta'); }}
                        className="flex items-center gap-2 text-slate-200 text-sm font-semibold"
                      >
                        <Send className="w-4 h-4 text-purple-300" /> Pedir um dorama
                      </button>
                      <button onClick={() => scrollToSection('top')} className="flex items-center gap-2 text-slate-200 text-sm">
                        <Sparkles className="w-4 h-4 text-purple-300" /> Início
                      </button>
                    </>
                  )}
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/novos'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Sparkles className="w-4 h-4 text-purple-400" /> Novos Lançamentos
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/dublados'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Globe className="w-4 h-4 text-blue-400" /> Séries Dubladas
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/gravidez-e-bebe'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Baby className="w-4 h-4 text-pink-400" /> Bebês e Gravidezes
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/relacionamento-tabu'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <HeartHandshake className="w-4 h-4 text-red-400" /> Relacionamento Tabu
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/lobos-e-vampiros'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Moon className="w-4 h-4 text-indigo-400" /> Lobos & Vampiros
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/bl-gl'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Heart className="w-4 h-4 text-rose-400" /> BL & GL
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/brasileiros'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Flag className="w-4 h-4 text-emerald-400" /> Brasileiros
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/animes'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Tv className="w-4 h-4 text-cyan-400" /> Animes
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/identidade-escondida'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Eye className="w-4 h-4 text-teal-400" /> Identidade Escondida
                  </button>
                  <button onClick={() => { setMobileMenuOpen(false); navigate('/recomendados'); }} className="flex items-center gap-2 text-slate-200 text-sm">
                    <Star className="w-4 h-4 text-amber-400" /> Recomendados Para Você
                  </button>
                </div>

                {isAdmin && (
                  <div className="pt-2 border-t border-slate-800 mt-2">
                    <p className="text-xs text-slate-500 mb-1">Admin</p>
                    <button
                      onClick={() => { setMobileMenuOpen(false); navigate('/admin/analytics'); }}
                      className="text-slate-200 text-sm text-left"
                    >
                      Painel Admin
                    </button>

                    {/* ✅ ADICIONADO: Admin Support (WhatsApp) no mobile */}
                    <button
                      onClick={() => { setMobileMenuOpen(false); navigate('/admin/support'); }}
                      className="mt-2 text-slate-200 text-sm text-left"
                    >
                      Atendimento WhatsApp
                    </button>

                    {/* ✅ ADICIONADO: Admin Dora (chat do site) no mobile */}
                    <button
                      onClick={() => { setMobileMenuOpen(false); navigate('/admin/dora'); }}
                      className="mt-2 text-slate-200 text-sm text-left block"
                    >
                      Dora (chat do site)
                    </button>
                  </div>
                )}

                {!showBottomNav && (
                <div className="pt-3 border-t border-slate-800 mt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <User className="w-5 h-5 text-purple-400" />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 truncate">{displayName}</p>
                      {user?.email && (
                        <p className="text-xs text-slate-400 truncate">{user.email}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      onClick={() => { setMobileMenuOpen(false); navigate('/minha-conta'); }}
                      className="flex items-center gap-2 text-slate-200 text-sm text-left"
                    >
                      <Settings className="w-4 h-4 text-purple-300" /> Configurações
                    </button>

                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm text-left"
                    >
                      <LogOut className="w-4 h-4" /> Sair
                    </button>
                  </div>
                </div>
                )}

                {!showBottomNav && (
                <div className="mt-3 p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-200 flex gap-3">
                  <div className="mt-1">
                    <CreditCard className="w-5 h-5 text-purple-400" />
                  </div>
                  <div className="w-full">
                    <p className="font-semibold text-sm">Status da sua assinatura</p>

                    {subLoading ? (
                      <p className="text-slate-400 mt-1">Carregando...</p>
                    ) : !subscription ? (
                      <p className="text-slate-400 mt-1">Você ainda não possui uma assinatura ativa.</p>
                    ) : (
                      <>
                        {planName && (
                          <p className="mt-1">
                            Plano: <span className="font-semibold text-white">{planName}</span>
                          </p>
                        )}

                        {statusLabel && (() => {
                          const lower = String(statusLabel).toLowerCase();
                          const isExpired = lower === 'canceled' || (typeof daysLeft === 'number' && daysLeft <= 0);
                          const displayStatus = isExpired ? 'Vencida' : statusLabel;
                          const colorClass = lower === 'active'
                            ? 'text-green-400 font-semibold'
                            : isExpired
                              ? 'text-red-400 font-semibold'
                              : 'text-amber-300 font-semibold';
                          return (
                            <p className="mt-1">
                              Status{' '}
                              <span className={colorClass}>{displayStatus}</span>
                            </p>
                          );
                        })()}

                        {nextBilling && (
                          <p className="mt-1 flex items-center gap-1">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            Vencimento: <span className="font-semibold text-white">{nextBilling}</span>
                          </p>
                        )}
                      </>
                    )}

                    {showRenewWarning && (
                      <button
                        type="button"
                        onClick={() => { setMobileMenuOpen(false); handleGoPlans(); }}
                        className="mt-3 inline-flex items-center gap-2 text-red-300 hover:text-red-200 font-semibold"
                      >
                        Renovar agora <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                )}

              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-center">Entrar</Button>
                </Link>
                <Link to="/signup" onClick={() => setMobileMenuOpen(false)}>
                  <Button className="w-full bg-purple-600 hover:bg-purple-700">Cadastrar</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
    </>
  );
};

export default Navbar;
