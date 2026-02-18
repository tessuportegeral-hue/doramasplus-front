// src/pages/AdminUsers.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  Loader2,
  Search,
  LogOut,
  UserX,
  User,
  Calendar,
  Hash,
  CreditCard,
  Droplet,
  PlusCircle,
  History,
  XCircle,
  KeyRound,
  Lock,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

const AdminUsers = () => {
  const [emailSearch, setEmailSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({ type: null, id: null });
  const [searched, setSearched] = useState(false);

  const [userProfile, setUserProfile] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);

  // modal assinatura manual
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const [manualSubData, setManualSubData] = useState({
    activationDate: today,
    duration: 30,
  });

  // plano escolhido pro Pix: 'padrao' | 'trimestral'
  const [selectedPlan, setSelectedPlan] = useState('padrao');

  // Auto-complete
  const [suggestions, setSuggestions] = useState([]);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);

  // loading para envio de email de redefinição
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  // modal trocar senha (NOVO)
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordActionLoading, setPasswordActionLoading] = useState(false);

  // ✅ NOVO: modal criar conta rápida
  const [isQuickCreateModalOpen, setIsQuickCreateModalOpen] = useState(false);
  const [quickCreateData, setQuickCreateData] = useState({
    name: '',
    phone: '',
    password: '123456',
  });
  const [quickCreateLoading, setQuickCreateLoading] = useState(false);

  const navigate = useNavigate();
  const { toast } = useToast();

  const formatDate = (dateString, withTime = true) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    const options = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...(withTime && { hour: '2-digit', minute: '2-digit' }),
    };
    return date.toLocaleString('pt-BR', options);
  };

  const getPremiumStatus = (subs) => {
    const now = new Date();

    const activeSub = (subs || []).find((s) => {
      if (s.status !== 'active' && s.status !== 'trialing') return false;
      const end = s.end_at || s.current_period_end;
      return end && new Date(end) > now;
    });

    if (!activeSub) return { text: 'Inativo', color: 'red' };

    // Identificação mais segura (não depende só de type)
    const provider = (activeSub.provider || activeSub.source || '').toString().toLowerCase();
    const type = (activeSub.type || '').toString().toLowerCase();

    if (type === 'manual' || activeSub.is_manual === true) {
      return { text: 'Ativo (Manual PIX)', color: 'blue' };
    }

    if (provider.includes('infinite') || type.includes('infinite')) {
      return { text: 'Ativo (InfinityPay)', color: 'blue' };
    }

    return { text: 'Ativo (Stripe)', color: 'green' };
  };

  // Busca principal (um usuário pelo email)
  const fetchUserDataAndSubs = async (email) => {
    setLoading(true);
    setSearched(true);
    setUserProfile(null);
    setSubscriptions([]);

    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .ilike('email', email.trim())
        .maybeSingle();

      if (profileError) throw profileError;

      if (!profile) {
        toast({
          variant: 'destructive',
          title: 'Usuário não encontrado',
          description: 'Nenhum usuário corresponde ao email fornecido.',
        });
        return;
      }

      setUserProfile(profile);

      const { data: subsData, error: subsError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', profile.id)
        .order('start_at', { ascending: false });

      if (subsError) throw subsError;

      setSubscriptions(subsData || []);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro na Busca',
        description: `Ocorreu um erro: ${err?.message || String(err)}`,
      });
      console.error('Fetch user data error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Digita no input -> busca sugestões
  const handleSearchChange = async (e) => {
    const value = e.target.value;
    setEmailSearch(value);
    setSearched(false);
    setUserProfile(null);
    setSubscriptions([]);

    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      setIsSearchingSuggestions(true);

      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, name')
        .ilike('email', `%${value.trim()}%`)
        .order('email', { ascending: true })
        .limit(10);

      if (error) {
        console.error('Erro ao buscar sugestões:', error);
        setSuggestions([]);
        return;
      }

      setSuggestions(data || []);
    } catch (err) {
      console.error('Erro inesperado nas sugestões:', err);
      setSuggestions([]);
    } finally {
      setIsSearchingSuggestions(false);
    }
  };

  // Clica no botão buscar
  const handleSearch = async () => {
    if (!emailSearch.trim()) {
      toast({
        variant: 'destructive',
        title: 'Campo vazio',
        description: 'Por favor, insira um email para buscar.',
      });
      return;
    }
    setSuggestions([]);
    await fetchUserDataAndSubs(emailSearch);
  };

  // Clica em uma sugestão
  const handleSelectSuggestion = async (user) => {
    setEmailSearch(user.email);
    setSuggestions([]);
    await fetchUserDataAndSubs(user.email);
  };

  // ✅ Adicionar/Atualizar assinatura manual (PIX) — UPSERT por user_id (não quebra Stripe/Infinity)
  const handleAddManualSubscription = async () => {
    if (!userProfile) return;
    setActionLoading({ type: 'add', id: null });

    try {
      const startDate = new Date(manualSubData.activationDate + 'T00:00:00Z');

      const isTrimestral = selectedPlan === 'trimestral';
      const defaultDays = isTrimestral ? 90 : 30;

      const durationDays =
        Number(manualSubData.duration) > 0
          ? Number(manualSubData.duration)
          : defaultDays;

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + durationDays);

      const planName = isTrimestral
        ? 'DoramasPlus Trimestral'
        : 'DoramasPlus Padrão';

      const planInterval = `${durationDays}d`;

      const upsertData = {
        user_id: userProfile.id,
        type: 'manual',
        status: 'active',
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        current_period_start: startDate.toISOString(),
        current_period_end: endDate.toISOString(),
        plan_name: planName,
        plan_interval: planInterval,
        source: 'admin_manual',
        provider: 'manual',
        is_manual: true,
        notes: `Assinatura manual adicionada/atualizada pelo admin (PIX) – ${planName} por ${durationDays} dias.`,

        // ✅ ÚNICA ADIÇÃO: marca a renovação manual no momento do upsert
        last_renewed_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from('subscriptions')
        .upsert(upsertData, { onConflict: 'user_id' });

      if (upsertError) throw upsertError;

      toast({
        title: 'Sucesso!',
        description: `Assinatura manual (${planName}) ativada/atualizada com sucesso.`,
        className: 'bg-green-600 text-white',
      });

      setIsManualModalOpen(false);
      await fetchUserDataAndSubs(userProfile.email);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: `Não foi possível adicionar a assinatura: ${error?.message || String(error)}`,
      });
      console.error('Add manual subscription error:', error);
    } finally {
      setActionLoading({ type: null, id: null });
    }
  };

  const handleCancelManualSubscription = async (subscriptionId) => {
    if (!userProfile) return;
    setActionLoading({ type: 'cancel', id: subscriptionId });

    try {
      const { error } = await supabase
        .from('subscriptions')
        .update({
          status: 'canceled',
          end_at: new Date().toISOString(),
          current_period_end: new Date().toISOString(),
        })
        .match({ id: subscriptionId, type: 'manual' });

      if (error) throw error;

      toast({
        title: 'Sucesso!',
        description: 'Assinatura manual cancelada com sucesso.',
        className: 'bg-green-600 text-white',
      });

      await fetchUserDataAndSubs(userProfile.email);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Não foi possível cancelar a assinatura.',
      });
      console.error('Cancel manual subscription error:', error);
    } finally {
      setActionLoading({ type: null, id: null });
    }
  };

  // Enviar e-mail de redefinição de senha
  const handleSendPasswordResetEmail = async () => {
    if (!userProfile?.email) {
      toast({
        title: 'Nenhum usuário selecionado',
        description: 'Pesquise um usuário e selecione-o antes de enviar o e-mail.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setResetPasswordLoading(true);

      const { error } = await supabase.auth.resetPasswordForEmail(userProfile.email, {
        redirectTo: 'https://www.doramasplus.com.br/reset-password',
      });

      if (error) {
        console.error('Erro ao enviar e-mail de redefinição:', error);
        toast({
          title: 'Erro ao enviar e-mail',
          description:
            error.message ||
            'Não foi possível enviar o e-mail de redefinição de senha. Tente novamente.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'E-mail enviado!',
        description: `Um e-mail de redefinição de senha foi enviado para ${userProfile.email}.`,
      });
    } catch (err) {
      console.error('Erro inesperado ao enviar e-mail de redefinição:', err);
      toast({
        title: 'Erro inesperado',
        description: 'Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setResetPasswordLoading(false);
    }
  };

  // ✅ NOVO: trocar senha direto no painel (Edge Function admin-set-password)
  const handleSetUserPassword = async () => {
    if (!userProfile?.id) {
      toast({
        title: 'Nenhum usuário selecionado',
        description: 'Pesquise um usuário antes de trocar a senha.',
        variant: 'destructive',
      });
      return;
    }

    if (!newPassword || newPassword.trim().length < 6) {
      toast({
        title: 'Senha fraca',
        description: 'Digite uma senha com pelo menos 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setPasswordActionLoading(true);

      // ✅ AJUSTE: pegar access_token do admin e mandar no header
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        toast({
          title: 'Sessão inválida',
          description: 'Você precisa estar logado como admin (Supabase Auth). Faça login novamente.',
          variant: 'destructive',
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('admin-set-password', {
        body: {
          user_id: userProfile.id,
          new_password: newPassword.trim(),
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, // ajuda em alguns setups
        },
      });

      if (error) throw error;

      toast({
        title: 'Senha alterada!',
        description: `Senha atualizada com sucesso para ${userProfile.email}.`,
        className: 'bg-green-600 text-white',
      });

      setIsPasswordModalOpen(false);
      setNewPassword('');
    } catch (err) {
      console.error('Erro ao trocar senha:', err);
      toast({
        title: 'Erro ao trocar senha',
        description: err?.message || 'Falha ao alterar a senha. Verifique a Edge Function.',
        variant: 'destructive',
      });
    } finally {
      setPasswordActionLoading(false);
    }
  };

  // ✅ NOVO: criar conta rápida (Edge Function admin-quick-create-user)
  const handleQuickCreateUser = async () => {
    if (!quickCreateData.name?.trim() || !quickCreateData.phone?.trim()) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha nome e WhatsApp.',
        variant: 'destructive',
      });
      return;
    }

    const pwd = String(quickCreateData.password || '').trim();
    if (!pwd || pwd.length < 6) {
      toast({
        title: 'Senha inválida',
        description: 'A senha precisa ter pelo menos 6 caracteres (ex: 123456).',
        variant: 'destructive',
      });
      return;
    }

    try {
      setQuickCreateLoading(true);

      // pega access_token do admin (JWT ligado)
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        toast({
          title: 'Sessão inválida',
          description: 'Você precisa estar logado como admin (Supabase Auth). Faça login novamente.',
          variant: 'destructive',
        });
        return;
      }

      const { data, error } = await supabase.functions.invoke('admin-quick-create-user', {
        body: {
          name: quickCreateData.name.trim(),
          phone: quickCreateData.phone.trim(),
          password: pwd,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
      });

      if (error) throw error;

      if (!data?.ok) {
        toast({
          title: 'Não foi possível criar',
          description:
            data?.error === 'already_exists'
              ? 'Já existe usuário com esse WhatsApp.'
              : 'Falha ao criar a conta. Veja logs da Edge Function.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Conta criada!',
        description: 'Usuário criado com sucesso.',
        className: 'bg-green-600 text-white',
      });

      setIsQuickCreateModalOpen(false);
      setQuickCreateData({ name: '', phone: '', password: '123456' });
    } catch (err) {
      console.error('Quick create error:', err);
      toast({
        title: 'Erro ao criar conta',
        description: err?.message || 'Falha ao criar conta. Verifique a Edge Function.',
        variant: 'destructive',
      });
    } finally {
      setQuickCreateLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('isAdmin');
    navigate('/admin/login');
  };

  const premiumStatus = getPremiumStatus(subscriptions);

  const StatusBadge = ({ status }) => {
    const styles = {
      green: 'bg-green-400/10 text-green-400 border-green-400/30',
      blue: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
      red: 'bg-red-400/10 text-red-400 border-red-400/30',
    };
    return (
      <span
        className={`px-3 py-1 text-sm font-semibold rounded-full border ${styles[status.color]}`}
      >
        {status.text}
      </span>
    );
  };

  const UserInfoCard = ({ profile }) => (
    <div className="bg-slate-900 p-5 rounded-lg border border-slate-800">
      <h2 className="text-xl font-bold text-purple-400 mb-4">
        Informações do Usuário
      </h2>

      <div className="space-y-3 text-slate-300">
        <div className="flex items-center gap-2">
          <User size={16} className="text-slate-500" />
          <span>{profile.name || 'Nome não fornecido'}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Email:</span>
          <span className="font-medium break-all">{profile.email}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Hash size={14} className="text-slate-500" />
          <span className="font-mono text-xs break-all">{profile.id}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Calendar size={14} className="text-slate-500" />
          <span>Criado em: {formatDate(profile.created_at, false)}</span>
        </div>

        <hr className="border-slate-700 my-4" />

        <div className="flex items-center justify-between">
          <span className="text-slate-400 font-medium">Status Premium:</span>
          <StatusBadge status={premiumStatus} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Helmet>
        <title>Gerenciar Usuários – DoramasPlus</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8">
        <header className="flex justify-between items-center mb-8 max-w-7xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-purple-400">
            Gerenciar Usuários
          </h1>

          {/* ✅ NOVO: Botão criar conta rápida + sair (mesmo lugar, sem mexer no resto) */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setIsQuickCreateModalOpen(true)}
              className="bg-purple-600 hover:bg-purple-700"
              size="sm"
            >
              <PlusCircle className="w-4 h-4 mr-2" />
              Criar Conta Rápida
            </Button>

            <Button onClick={handleLogout} variant="destructive" size="sm">
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto">
          {/* Busca com auto-complete */}
          <div className="bg-slate-900 p-6 rounded-lg border border-slate-800 shadow-lg mb-8">
            <div className="relative flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <input
                  type="email"
                  value={emailSearch}
                  onChange={handleSearchChange}
                  placeholder="Buscar usuário por email..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />

                {emailSearch.trim().length >= 2 && suggestions.length > 0 && (
                  <div className="absolute mt-1 w-full bg-slate-900 border border-slate-700 rounded-md max-h-60 overflow-y-auto z-20">
                    {suggestions.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-slate-800 text-sm text-slate-100"
                        onClick={() => handleSelectSuggestion(u)}
                      >
                        <div className="font-medium">{u.email}</div>
                        {u.name && (
                          <div className="text-xs text-slate-400">{u.name}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {emailSearch.trim().length >= 2 &&
                  !isSearchingSuggestions &&
                  suggestions.length === 0 && (
                    <div className="absolute mt-1 w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-400 z-20">
                      Nenhum usuário encontrado para esse termo.
                    </div>
                  )}
              </div>

              <Button
                onClick={handleSearch}
                disabled={loading}
                className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Search className="w-4 h-4 mr-2" />
                )}
                Buscar
              </Button>
            </div>
          </div>

          {loading && (
            <div className="text-center p-8">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-purple-400" />
              <p className="mt-4 text-slate-400">Buscando...</p>
            </div>
          )}

          {!loading && searched && !userProfile && (
            <div className="text-center p-8 bg-slate-900 rounded-lg border border-slate-800">
              <UserX className="w-12 h-12 mx-auto text-slate-500" />
              <p className="mt-4 text-lg font-semibold text-slate-300">
                Usuário não encontrado
              </p>
            </div>
          )}

          {userProfile && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <aside className="lg:col-span-1 flex flex-col gap-6">
                <UserInfoCard profile={userProfile} />

                {/* Card senha (RECUPERAÇÃO + TROCA DIRETA) */}
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                  <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-300" />
                    Senha do usuário
                  </h3>

                  <p className="text-sm text-slate-300">
                    Você pode enviar o e-mail de redefinição OU trocar a senha direto (admin).
                  </p>

                  <p className="text-xs text-slate-400 mt-2">
                    Usuário selecionado:{' '}
                    <span className="font-medium text-slate-100">
                      {userProfile.email}
                    </span>
                  </p>

                  <Button
                    className="mt-3 w-full"
                    onClick={handleSendPasswordResetEmail}
                    disabled={resetPasswordLoading}
                  >
                    {resetPasswordLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Enviando e-mail...
                      </>
                    ) : (
                      'Enviar e-mail de redefinição'
                    )}
                  </Button>

                  <Button
                    className="mt-2 w-full bg-slate-800 hover:bg-slate-700"
                    onClick={() => setIsPasswordModalOpen(true)}
                    disabled={!userProfile?.id}
                  >
                    <KeyRound className="w-4 h-4 mr-2" />
                    Trocar senha direto
                  </Button>
                </div>

                <Button
                  onClick={() => setIsManualModalOpen(true)}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Adicionar Assinatura Manual (PIX)
                </Button>
              </aside>

              <section className="lg:col-span-2">
                <h2 className="text-xl font-bold text-purple-400 mb-4 flex items-center gap-2">
                  <History size={20} />
                  Histórico de Assinaturas
                </h2>

                <div className="space-y-4">
                  {subscriptions.length > 0 ? (
                    subscriptions.map((sub) => {
                      const type = (sub.type || '').toString().toLowerCase();
                      const provider = (sub.provider || sub.source || '').toString().toLowerCase();

                      const isManual = type === 'manual' || sub.is_manual === true;
                      const isInfinity = provider.includes('infinite') || type.includes('infinite');

                      return (
                        <div
                          key={sub.id}
                          className={`p-4 rounded-lg border text-sm ${
                            isManual || isInfinity
                              ? 'bg-blue-950/50 border-blue-500/30'
                              : 'bg-slate-900 border-slate-800'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-3">
                            <h3 className="font-semibold text-slate-100 flex items-center gap-2">
                              {isManual || isInfinity ? (
                                <>
                                  <Droplet size={16} className="text-blue-400" />
                                  {isManual ? 'Manual (PIX)' : 'InfinityPay (PIX)'}
                                </>
                              ) : (
                                <>
                                  <CreditCard size={16} className="text-slate-400" />
                                  Stripe
                                </>
                              )}
                            </h3>

                            <span
                              className={`px-2 py-0.5 text-xs font-semibold rounded-full capitalize ${
                                sub.status === 'active'
                                  ? 'bg-green-900/50 text-green-300'
                                  : 'bg-red-900/50 text-red-300'
                              }`}
                            >
                              {sub.status}
                            </span>
                          </div>

                          <div className="text-slate-400 space-y-2">
                            <p>
                              Plano:{' '}
                              <span className="text-slate-200">
                                {sub.plan_name || 'N/A'} ({sub.plan_interval || 'N/A'})
                              </span>
                            </p>

                            <p>
                              Início:{' '}
                              <span className="text-slate-200">
                                {formatDate(sub.start_at || sub.current_period_start || sub.created_at)}
                              </span>
                            </p>

                            <p>
                              Fim:{' '}
                              <span className="text-slate-200">
                                {formatDate(sub.end_at || sub.current_period_end)}
                              </span>
                            </p>

                            {(sub.source || sub.notes) && (
                              <p className="text-xs pt-2 border-t border-slate-700 mt-2 text-slate-500">
                                {sub.source && <span>Fonte: {sub.source} | </span>}
                                {sub.notes && <span>Notas: {sub.notes}</span>}
                              </p>
                            )}
                          </div>

                          {isManual && sub.status === 'active' && (
                            <div className="mt-4 border-t border-slate-700 pt-3">
                              <Button
                                onClick={() => handleCancelManualSubscription(sub.id)}
                                disabled={actionLoading.type === 'cancel'}
                                size="sm"
                                variant="destructive"
                              >
                                {actionLoading.type === 'cancel' ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <XCircle className="w-4 h-4 mr-2" />
                                )}
                                Cancelar Assinatura Manual
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center p-8 bg-slate-900 rounded-lg border border-slate-800">
                      <p className="text-slate-400">Nenhuma assinatura registrada ainda.</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>

        {/* MODAL: Assinatura manual */}
        <Dialog open={isManualModalOpen} onOpenChange={setIsManualModalOpen}>
          <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-purple-400">
                Adicionar Assinatura Manual (PIX)
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-200">Escolha o plano</span>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlan('padrao');
                      setManualSubData((prev) => ({ ...prev, duration: 30 }));
                    }}
                    className={`flex-1 text-xs sm:text-sm px-3 py-2 rounded-md border ${
                      selectedPlan === 'padrao'
                        ? 'border-purple-500 bg-purple-600/20 text-purple-200'
                        : 'border-slate-600 bg-slate-800 text-slate-200'
                    }`}
                  >
                    DoramasPlus Padrão — 30 dias
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlan('trimestral');
                      setManualSubData((prev) => ({ ...prev, duration: 90 }));
                    }}
                    className={`flex-1 text-xs sm:text-sm px-3 py-2 rounded-md border ${
                      selectedPlan === 'trimestral'
                        ? 'border-purple-500 bg-purple-600/20 text-purple-200'
                        : 'border-slate-600 bg-slate-800 text-slate-200'
                    }`}
                  >
                    DoramasPlus Trimestral — 90 dias
                  </button>
                </div>

                <p className="text-[11px] text-slate-500">
                  Você pode ajustar manualmente a quantidade de dias abaixo, se precisar fazer exceção.
                </p>
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="activationDate" className="text-right text-sm">
                  Data de Início
                </label>
                <input
                  id="activationDate"
                  type="date"
                  value={manualSubData.activationDate}
                  onChange={(e) =>
                    setManualSubData({
                      ...manualSubData,
                      activationDate: e.target.value,
                    })
                  }
                  className="col-span-3 bg-slate-800 border border-slate-600 rounded p-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <label htmlFor="duration" className="text-right text-sm">
                  Dias de Duração
                </label>
                <input
                  id="duration"
                  type="number"
                  value={manualSubData.duration}
                  onChange={(e) =>
                    setManualSubData({
                      ...manualSubData,
                      duration: e.target.value,
                    })
                  }
                  className="col-span-3 bg-slate-800 border border-slate-600 rounded p-2 text-sm"
                />
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>

              <Button
                onClick={handleAddManualSubscription}
                disabled={actionLoading.type === 'add'}
                className="bg-green-600 hover:bg-green-700"
              >
                {actionLoading.type === 'add' && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODAL: Trocar senha (NOVO) */}
        <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
          <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-purple-400">
                Trocar senha do usuário
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-3 py-2">
              <p className="text-sm text-slate-300">
                Usuário: <span className="text-slate-100 font-medium">{userProfile?.email}</span>
              </p>

              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Digite a nova senha (mín. 6 caracteres)"
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />

              <p className="text-xs text-slate-500">
                Isso altera a senha diretamente via Edge Function <b>admin-set-password</b>.
              </p>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>

              <Button
                onClick={handleSetUserPassword}
                disabled={passwordActionLoading}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {passwordActionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Alterando...
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4 mr-2" />
                    Alterar senha
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ✅ NOVO: MODAL Criar Conta Rápida */}
        <Dialog open={isQuickCreateModalOpen} onOpenChange={setIsQuickCreateModalOpen}>
          <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-purple-400">
                Criar Conta Rápida
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-3 py-2">
              <input
                type="text"
                value={quickCreateData.name}
                onChange={(e) => setQuickCreateData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Nome do usuário"
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />

              <input
                type="text"
                value={quickCreateData.phone}
                onChange={(e) => setQuickCreateData((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="WhatsApp com DDD (ex: 11999999999)"
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />

              <input
                type="text"
                value={quickCreateData.password}
                onChange={(e) =>
                  setQuickCreateData((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="Senha (ex: 123456)"
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />

              <p className="text-xs text-slate-500">
                O usuário entra com <b>WhatsApp + senha</b>.
              </p>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancelar</Button>
              </DialogClose>

              <Button
                onClick={handleQuickCreateUser}
                disabled={quickCreateLoading}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {quickCreateLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-4 h-4 mr-2" />
                    Criar
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};

export default AdminUsers;
