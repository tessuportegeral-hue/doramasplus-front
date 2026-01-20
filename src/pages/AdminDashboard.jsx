// src/pages/AdminDashboard.jsx
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
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

const AdminDashboard = () => {
  const [emailSearch, setEmailSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({ type: null, id: null });
  const [searched, setSearched] = useState(false);

  const [userProfile, setUserProfile] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const [manualSubData, setManualSubData] = useState({
    activationDate: today,
    duration: 30,
  });

  // plano escolhido pro Pix: 'padrao' | 'trimestral'
  const [selectedPlan, setSelectedPlan] = useState < 'padrao' | 'trimestral' > ('padrao');

  // Auto-complete
  const [suggestions, setSuggestions] = useState([]);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);

  // loading para envio de email de redefinição
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

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
    const activeSub = subs.find(
      (s) =>
        s.status === 'active' &&
        new Date(s.end_at || s.current_period_end) > new Date()
    );

    if (activeSub) {
      if (activeSub.type === 'manual') {
        return { text: 'Ativo (Manual PIX)', color: 'blue' };
      }
      return { text: 'Ativo (Stripe)', color: 'green' };
    }
    return { text: 'Inativo', color: 'red' };
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
        description: `Ocorreu um erro: ${err.message}`,
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

  const handleAddManualSubscription = async () => {
    if (!userProfile) return;
    setActionLoading({ type: 'add', id: null });

    try {
      // data de início escolhida
      const startDate = new Date(manualSubData.activationDate + 'T00:00:00Z');

      // define plano e dias
      const isTrimestral = selectedPlan === 'trimestral';
      const defaultDays = isTrimestral ? 90 : 30;

      const durationDays =
        Number(manualSubData.duration) > 0
          ? Number(manualSubData.duration)
          : defaultDays;

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + durationDays);

      const planName = isTrimestral
        ? 'DoramaPlay Trimestral'
        : 'DoramaPlay Padrão';

      const planInterval = `${durationDays}d`;

      // ✅ CORREÇÃO: como existe UNIQUE(user_id), não pode INSERT quando já existe registro (Stripe/Infinity).
      // Então fazemos UPSERT por user_id.
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
        is_manual: true,
        notes: `Assinatura manual adicionada/atualizada pelo admin (PIX) – ${planName} por ${durationDays} dias.`,
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

      setIsModalOpen(false);
      await fetchUserDataAndSubs(userProfile.email);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: `Não foi possível adicionar a assinatura: ${error.message}`,
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

  // Enviar e-mail de redefinição de senha para o usuário selecionado
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

      const { error } = await supabase.auth.resetPasswordForEmail(
        userProfile.email,
        {
          redirectTo: 'https://www.doramasplus.com.br/reset-password',
        }
      );

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
        <title>Painel Admin – DoramaStream</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 lg:p-8">
        <header className="flex justify-between items-center mb-8 max-w-7xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-purple-400">
            Painel Admin
          </h1>
          <Button onClick={handleLogout} variant="destructive" size="sm">
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
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

                {emailSearch.trim().length >= 2 &&
                  suggestions.length > 0 && (
                    <div className="absolute mt-1 w-full bg-slate-900 border border-slate-700 rounded-md max-h-60 overflow-y-auto z-20">
                      {suggestions.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-slate-800 text-sm text-slate-100"
                          onClick={() => handleSelectSuggestion(user)}
                        >
                          <div className="font-medium">{user.email}</div>
                          {user.name && (
                            <div className="text-xs text-slate-400">
                              {user.name}
                            </div>
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

                {/* Card de gerenciamento de senha */}
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                  <h3 className="text-lg font-semibold mb-2">
                    Gerenciar senha do usuário
                  </h3>
                  <p className="text-sm text-slate-300">
                    Envie um e-mail de redefinição de senha para este usuário.
                    Ele receberá um link para criar uma nova senha.
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
                      'Enviar e-mail de redefinição de senha'
                    )}
                  </Button>
                </div>

                <Button
                  onClick={() => setIsModalOpen(true)}
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
                    subscriptions.map((sub) => (
                      <div
                        key={sub.id}
                        className={`p-4 rounded-lg border text-sm ${
                          sub.type === 'manual'
                            ? 'bg-blue-950/50 border-blue-500/30'
                            : 'bg-slate-900 border-slate-800'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <h3 className="font-semibold text-slate-100 flex items-center gap-2">
                            {sub.type === 'manual' ? (
                              <>
                                <Droplet size={16} className="text-blue-400" />
                                Manual (PIX)
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
                              {formatDate(sub.start_at || sub.created_at)}
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

                        {sub.type === 'manual' && sub.status === 'active' && (
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
                    ))
                  ) : (
                    <div className="text-center p-8 bg-slate-900 rounded-lg border border-slate-800">
                      <p className="text-slate-400">
                        Nenhuma assinatura registrada ainda.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>

        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-purple-400">
                Adicionar Assinatura Manual (PIX)
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              {/* Escolha rápida de plano */}
              <div className="flex flex-col gap-2">
                <span className="text-sm text-slate-200">Escolha o plano</span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlan('padrao');
                      setManualSubData((prev) => ({
                        ...prev,
                        duration: 30,
                      }));
                    }}
                    className={`flex-1 text-xs sm:text-sm px-3 py-2 rounded-md border ${
                      selectedPlan === 'padrao'
                        ? 'border-purple-500 bg-purple-600/20 text-purple-200'
                        : 'border-slate-600 bg-slate-800 text-slate-200'
                    }`}
                  >
                    DoramaPlay Padrão — 30 dias
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlan('trimestral');
                      setManualSubData((prev) => ({
                        ...prev,
                        duration: 90,
                      }));
                    }}
                    className={`flex-1 text-xs sm:text-sm px-3 py-2 rounded-md border ${
                      selectedPlan === 'trimestral'
                        ? 'border-purple-500 bg-purple-600/20 text-purple-200'
                        : 'border-slate-600 bg-slate-800 text-slate-200'
                    }`}
                  >
                    DoramaPlay Trimestral — 90 dias
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Você pode ajustar manualmente a quantidade de dias abaixo, se
                  precisar fazer alguma exceção.
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
      </div>
    </>
  );
};

export default AdminDashboard;