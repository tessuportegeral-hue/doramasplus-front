import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CreditCard,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Gift,
  Users,
  Copy,
  Check,
  User,
  KeyRound,
  Eye,
  EyeOff,
  Smartphone,
  Trash2,
  ShieldCheck,
  ChevronRight,
  Clapperboard,
  Send,
  LogOut,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import DeleteAccountModal from '@/components/DeleteAccountModal';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';

const PLANS_URL = '/plans';
const CHANGE_PASSWORD_URL =
  'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/change-password';
const LIST_DEVICES_URL =
  'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/list-devices';
const REVOKE_DEVICE_URL =
  'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/revoke-device';
const REVOKE_ALL_DEVICES_URL =
  'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/revoke-all-devices';
const DEVICE_KEY = 'dp_device_id';

const cardClass = 'rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6';

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
        {icon}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}

function PlanoCard({ user }) {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchSub = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        setSubscription(data || null);
      } catch (err) {
        console.error('Erro ao carregar assinatura:', err);
        if (!cancelled) setSubscription(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchSub();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const formatDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const nextBillingRaw =
    subscription?.current_period_end ||
    subscription?.expires_at ||
    subscription?.current_period_end_at ||
    subscription?.period_end ||
    null;

  const nextBilling = formatDate(nextBillingRaw);
  const planName = subscription?.plan_name || subscription?.price_nickname || null;
  const statusRaw = String(subscription?.status || '').toLowerCase();
  const isActive = statusRaw === 'active' || statusRaw === 'trialing';

  const daysLeft = useMemo(() => {
    if (!nextBillingRaw) return null;
    const end = new Date(nextBillingRaw);
    if (Number.isNaN(end.getTime())) return null;
    const now = new Date();
    const diffMs = end.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }, [nextBillingRaw]);

  const expired = typeof daysLeft === 'number' && daysLeft <= 0;
  const isCanceledOrExpired = statusRaw === 'canceled' || expired;
  const noSubscription = !loading && !subscription;
  const showRenew = noSubscription || expired || !isActive;

  return (
    <div className={cardClass}>
      <SectionHeader
        icon={<CreditCard className="w-5 h-5 text-purple-300" />}
        title="Minha Assinatura"
        subtitle={user?.email || ''}
      />

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : noSubscription ? (
        <div className="text-sm text-slate-300">
          <p className="mb-4">Você ainda não possui uma assinatura ativa.</p>
          <Link to={PLANS_URL}>
            <Button className="bg-purple-600 hover:bg-purple-700">
              Ver planos <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {planName && (
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-slate-400">Plano</span>
              <span className="font-semibold text-white">{planName}</span>
            </div>
          )}

          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-slate-400">Status</span>
            {isActive ? (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold">
                <CheckCircle2 className="w-4 h-4" /> Ativa
              </span>
            ) : isCanceledOrExpired ? (
              <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                <AlertTriangle className="w-4 h-4" /> Vencida
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                <AlertTriangle className="w-4 h-4" />
                {statusRaw || 'inativa'}
              </span>
            )}
          </div>

          {nextBilling && (
            <div className="flex items-center justify-between">
              <span className="text-slate-400 inline-flex items-center gap-1">
                <Calendar className="w-4 h-4" /> Vencimento
              </span>
              <span className="font-semibold text-white">
                {nextBilling}
                {typeof daysLeft === 'number' && daysLeft > 0 && (
                  <span className="ml-2 text-xs text-slate-400 font-normal">
                    ({daysLeft} {daysLeft === 1 ? 'dia' : 'dias'})
                  </span>
                )}
              </span>
            </div>
          )}

          {showRenew && (
            <div className="pt-4">
              <Link to={PLANS_URL}>
                <Button className="w-full bg-purple-600 hover:bg-purple-700">
                  Renovar assinatura <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IndicacaoCard({ user }) {
  const [refCode, setRefCode] = useState('');
  const [creditedCount, setCreditedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const inviteLink = useMemo(
    () => (refCode ? `https://doramasplus.com.br/cadastro?ref=${refCode}` : ''),
    [refCode]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      try {
        const [{ data: profile }, { count }] = await Promise.all([
          supabase.from('profiles').select('ref_code').eq('id', user.id).maybeSingle(),
          supabase
            .from('referrals')
            .select('id', { count: 'exact', head: true })
            .eq('referrer_id', user.id)
            .eq('status', 'credited'),
        ]);
        if (cancelled) return;
        setRefCode(profile?.ref_code || '');
        setCreditedCount(count || 0);
      } catch (e) {
        console.error('[Configurações] erro ao carregar indicação:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({ title: 'Link copiado!', description: 'Cole onde quiser compartilhar.' });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({
        title: 'Não foi possível copiar',
        description: 'Selecione o link manualmente.',
        variant: 'destructive',
      });
    }
  };

  const daysEarned = creditedCount * 15;

  return (
    <div className={cardClass}>
      <SectionHeader
        icon={<Gift className="w-5 h-5 text-emerald-300" />}
        title="Indique e ganhe dias grátis"
        subtitle="A cada amigo que pagar pelo seu link, você ganha 15 dias"
      />

      {loading ? (
        <div className="h-11 rounded-lg bg-white/5 animate-pulse mb-4" />
      ) : !inviteLink ? (
        <p className="text-sm text-slate-500 mb-4">
          Não foi possível carregar seu código. Recarregue a página.
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            readOnly
            value={inviteLink}
            onFocus={(e) => e.target.select()}
            className="flex-1 rounded-lg bg-white/5 border border-slate-700 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500/60"
          />
          <Button onClick={handleCopy} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2" /> Copiado
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" /> Copiar
              </>
            )}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-white/5 border border-slate-800 p-3">
          <div className="flex items-center gap-2 mb-1 text-xs text-slate-400">
            <Users className="w-3.5 h-3.5" /> Indicações válidas
          </div>
          <p className="text-xl font-bold text-white">{loading ? '—' : creditedCount}</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-slate-800 p-3">
          <div className="flex items-center gap-2 mb-1 text-xs text-slate-400">
            <Calendar className="w-3.5 h-3.5" /> Dias ganhos
          </div>
          <p className="text-xl font-bold text-white">{loading ? '—' : daysEarned}</p>
        </div>
      </div>
    </div>
  );
}

const LIMITE_JANELA_HORAS = 24;
const LIMITE_PEDIDOS = 5;

function PedirDoramaCard({ user }) {
  const [titulo, setTitulo] = useState('');
  const [sending, setSending] = useState(false);
  const [meusPedidos, setMeusPedidos] = useState([]);
  const [pedidosDoramasById, setPedidosDoramasById] = useState({});
  const [loadingPedidos, setLoadingPedidos] = useState(true);
  const [horasParaLiberar, setHorasParaLiberar] = useState(null);
  const [jaTem, setJaTem] = useState(null);

  const loadMeusPedidos = async () => {
    if (!user?.id) {
      setLoadingPedidos(false);
      return;
    }
    try {
      setLoadingPedidos(true);
      const { data } = await supabase
        .from('dorama_requests')
        .select('id, dorama_name, dorama_id, notified_at, dismissed_at, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(LIMITE_PEDIDOS);
      setMeusPedidos(data || []);

      const doramaIds = [...new Set((data || []).map((p) => p.dorama_id).filter(Boolean))];
      if (doramaIds.length) {
        const { data: doramasData } = await supabase
          .from('doramas')
          .select('id, title, slug')
          .in('id', doramaIds);
        setPedidosDoramasById(
          Object.fromEntries((doramasData || []).map((d) => [d.id, d]))
        );
      } else {
        setPedidosDoramasById({});
      }

      // conta só os pedidos dentro da janela de 24h (o que realmente conta pro limite)
      const janelaInicio = Date.now() - LIMITE_JANELA_HORAS * 3600000;
      const { data: recentes } = await supabase
        .from('dorama_requests')
        .select('created_at')
        .eq('user_id', user.id)
        .gte('created_at', new Date(janelaInicio).toISOString())
        .order('created_at', { ascending: true });

      const recentesRows = recentes || [];
      if (recentesRows.length >= LIMITE_PEDIDOS) {
        const maisAntigo = new Date(recentesRows[0].created_at).getTime();
        const horasPassadas = (Date.now() - maisAntigo) / 3600000;
        setHorasParaLiberar(Math.max(1, Math.ceil(LIMITE_JANELA_HORAS - horasPassadas)));
      } else {
        setHorasParaLiberar(null);
      }
    } finally {
      setLoadingPedidos(false);
    }
  };

  useEffect(() => {
    loadMeusPedidos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ✅ 05/08: o "já temos X" é uma SUGESTÃO, não pode travar o pedido — antes,
  // quando o fuzzy match achava algo parecido (sim > 0.4, bem permissivo), o
  // pedido simplesmente não ia pra frente, mesmo sendo um título diferente.
  // Agora, se não for forçado, mostra a sugestão mas mantém o texto digitado;
  // a pessoa decide se quer pedir mesmo assim.
  const handlePedir = async (forcar = false) => {
    const nome = titulo.trim();
    if (!nome || !user?.id) return;
    try {
      setSending(true);

      if (!forcar) {
        // já tem no catálogo? avisa na hora em vez de registrar pedido à toa
        const { data: encontrados } = await supabase.rpc('search_doramas_fuzzy', { query: nome });
        const achado = (encontrados || []).find((d) => d.sim > 0.4);
        if (achado) {
          setJaTem(achado);
          toast({
            title: 'Esse a gente já tem! 🎉',
            description: `"${achado.title}" já está no catálogo. Se não for o que você procura, pode pedir mesmo assim.`,
          });
          return;
        }
      }
      setJaTem(null);

      const { error } = await supabase
        .from('dorama_requests')
        .insert({ user_id: user.id, dorama_name: nome, source: 'site' });
      if (error) throw error;
      setTitulo('');
      toast({
        title: 'Pedido registrado! 🎬',
        description: 'Assim que adicionarmos, avisamos você por aqui.',
      });
      await loadMeusPedidos();
    } catch (err) {
      const limite = String(err?.message || '').includes('dorama_request_limit_reached');
      toast({
        title: limite ? 'Limite de pedidos atingido' : 'Não foi possível registrar seu pedido',
        description: limite
          ? `Você já pediu ${LIMITE_PEDIDOS} doramas nas últimas ${LIMITE_JANELA_HORAS} horas. Aguarde pra pedir mais.`
          : 'Tente novamente em instantes.',
        variant: 'destructive',
      });
      await loadMeusPedidos();
    } finally {
      setSending(false);
    }
  };

  const limiteAtingido = horasParaLiberar !== null;

  return (
    <div className={cardClass}>
      <SectionHeader
        icon={<Clapperboard className="w-5 h-5 text-purple-300" />}
        title="Pedir um Dorama"
        subtitle="Não achou o que procurava? Peça aqui — avisamos quando adicionarmos"
      />

      {jaTem && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 mb-4">
          <Link
            to={`/dorama/${jaTem.slug}`}
            className="flex items-center justify-between hover:opacity-80 transition"
          >
            <span className="text-sm text-emerald-200">
              🎉 Já temos <span className="font-semibold">{jaTem.title}</span>!
            </span>
            <span className="text-xs text-emerald-300 font-semibold flex-shrink-0">Assistir →</span>
          </Link>
          <button
            type="button"
            onClick={() => handlePedir(true)}
            disabled={sending}
            className="mt-2 text-xs text-slate-400 hover:text-slate-200 underline disabled:opacity-50"
          >
            Não é esse, pedir mesmo assim
          </button>
        </div>
      )}

      {limiteAtingido ? (
        <p className="text-sm text-amber-300 mb-4">
          Você atingiu o limite de {LIMITE_PEDIDOS} pedidos por dia.{' '}
          {horasParaLiberar === 1
            ? 'Libera espaço pra pedir de novo em 1 hora.'
            : `Libera espaço pra pedir de novo em ${horasParaLiberar} horas.`}
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            type="text"
            value={titulo}
            onChange={(e) => {
              setTitulo(e.target.value);
              if (jaTem) setJaTem(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handlePedir()}
            placeholder="Nome do dorama que você quer assistir"
            className="flex-1 rounded-lg bg-white/5 border border-slate-700 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500/60"
          />
          <Button
            type="button"
            onClick={() => handlePedir()}
            disabled={!titulo.trim() || sending}
            className="bg-purple-600 hover:bg-purple-700 flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            {sending ? 'Enviando…' : 'Pedir'}
          </Button>
        </div>
      )}

      {!loadingPedidos && meusPedidos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500 mb-1">Seus pedidos</p>
          {meusPedidos.map((p) => {
            const doramaLinkado = p.dorama_id ? pedidosDoramasById[p.dorama_id] : null;
            return (
              <div key={p.id} className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-300 truncate">{p.dorama_name}</span>
                {p.notified_at && doramaLinkado ? (
                  <Link
                    to={`/dorama/${doramaLinkado.slug}`}
                    className="text-emerald-400 font-semibold hover:text-emerald-300 flex-shrink-0"
                  >
                    Adicionado — Assistir →
                  </Link>
                ) : p.notified_at ? (
                  <span className="text-emerald-400 font-semibold flex-shrink-0">Adicionado</span>
                ) : p.dismissed_at ? (
                  <span className="text-slate-600 flex-shrink-0">Não disponível</span>
                ) : (
                  <span className="text-slate-500 flex-shrink-0">Em análise</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ✅ 07/08 — TESTE: pro tesagencia, opção de deslogar perto de excluir
// conta (na aba Perfil da barra inferior o menu hamburguer/dropdown com
// "Sair" não é mais o caminho principal). Mesmo padrão do handleLogout
// do Navbar.jsx.
function SairContaCard() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      toast({
        title: 'Desconectado com sucesso',
        description: 'Até logo!',
      });
      navigate('/');
      setTimeout(() => window.location.reload(), 150);
    } catch (err) {
      toast({
        title: 'Erro ao desconectar',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">Sair da Conta</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Encerra sua sessão neste aparelho.
          </p>
        </div>
        <Button
          type="button"
          onClick={handleLogout}
          variant="ghost"
          className="border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 rounded-full px-4 flex items-center gap-2 flex-shrink-0"
        >
          <LogOut className="w-4 h-4" /> Sair da conta
        </Button>
      </div>
    </div>
  );
}

function ExcluirContaCard() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-red-300">Excluir Conta</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Apaga seu cadastro e assinatura definitivamente. Não tem como desfazer.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setModalOpen(true)}
            variant="ghost"
            className="border border-red-500/40 text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded-full px-4 flex items-center gap-2 flex-shrink-0"
          >
            <Trash2 className="w-4 h-4" /> Excluir conta
          </Button>
        </div>
      </div>

      <DeleteAccountModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

function ContaCard({ user }) {
  const [name, setName] = useState(user?.user_metadata?.name || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const loadName = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled && data?.name) setName(data.name);
    };
    loadName();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSave = async () => {
    if (!user?.id || !name.trim()) return;
    try {
      setSaving(true);
      setSavedMsg('');
      const { error } = await supabase
        .from('profiles')
        .update({ name: name.trim() })
        .eq('id', user.id);
      if (error) throw error;
      setSavedMsg('Nome atualizado!');
      setTimeout(() => setSavedMsg(''), 2500);
    } catch (err) {
      setSavedMsg('Erro ao salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cardClass}>
      <SectionHeader
        icon={<User className="w-5 h-5 text-purple-300" />}
        title="Configuração da Conta"
        subtitle="Gerencie suas informações pessoais"
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg bg-white/5 border border-slate-700 px-3 py-2 text-sm text-white outline-none focus:border-purple-500/60"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">E-mail</label>
          <input
            type="text"
            value={user?.email || ''}
            disabled
            className="w-full rounded-lg bg-white/5 border border-slate-800 px-3 py-2 text-sm text-slate-400 outline-none cursor-not-allowed"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="bg-purple-600 hover:bg-purple-700"
        >
          {saving ? 'Salvando…' : 'Salvar nome'}
        </Button>
        {savedMsg && <span className="text-xs text-slate-400">{savedMsg}</span>}
      </div>
    </div>
  );
}

function SenhaCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 6 &&
    confirmPassword.length >= 6 &&
    newPassword === confirmPassword &&
    !loading;

  const inputCls =
    'w-full rounded-lg bg-white/5 border border-slate-700 px-3 py-2 pr-10 text-sm text-white outline-none focus:border-purple-500/60';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      setLoading(true);
      setError('');

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError('Sessão expirada. Faça login novamente.');
        return;
      }

      const res = await fetch(CHANGE_PASSWORD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || body?.message || `Erro ao trocar senha (${res.status}).`);
        return;
      }

      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      setError(String(err?.message || 'Erro inesperado. Tente novamente.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cardClass}>
      <SectionHeader
        icon={<KeyRound className="w-5 h-5 text-purple-300" />}
        title="Alterar Senha"
        subtitle="Informe a senha atual e escolha uma nova"
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Senha Atual</label>
          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => setShowCurrent((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Nova Senha</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Confirmar Nova Senha</label>
            <input
              type={showNew ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
              className="w-full rounded-lg bg-white/5 border border-slate-700 px-3 py-2 text-sm text-white outline-none focus:border-purple-500/60"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {success && <p className="text-sm text-emerald-400">Senha alterada com sucesso!</p>}

        <Button
          type="submit"
          disabled={!canSubmit}
          className="bg-purple-600 hover:bg-purple-700"
        >
          {loading ? 'Salvando…' : 'Atualizar Senha'}
        </Button>
      </form>
    </div>
  );
}

function DispositivosCard() {
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState([]);
  const [maxStreams, setMaxStreams] = useState(1);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(DEVICE_KEY, id);
      }
      setCurrentDeviceId(id);
    } catch {
      setCurrentDeviceId('');
    }
  }, []);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(LIST_DEVICES_URL, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Erro ao carregar dispositivos');
      setActive(data.active || []);
      setMaxStreams(data.max_streams ?? 1);
    } catch (err) {
      setError('Não foi possível carregar os dispositivos agora.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatWhen = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleRevoke = async (deviceId) => {
    try {
      setBusyId(deviceId);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      await fetch(REVOKE_DEVICE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_id: deviceId }),
      });
      await load();
    } finally {
      setBusyId('');
    }
  };

  const handleRevokeAll = async () => {
    try {
      setBusyId('all');
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      await fetch(REVOKE_ALL_DEVICES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keep_device_id: currentDeviceId }),
      });
      await load();
    } finally {
      setBusyId('');
    }
  };

  const current = active.find((d) => d.device_id === currentDeviceId);
  const others = active.filter((d) => d.device_id !== currentDeviceId);

  return (
    <div className={cardClass}>
      <SectionHeader
        icon={<Smartphone className="w-5 h-5 text-purple-300" />}
        title="Gerenciar Dispositivos"
        subtitle="Dispositivos que estão assistindo com essa conta agora"
      />

      {loading ? (
        <div className="h-16 rounded-lg bg-white/5 animate-pulse" />
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-3">
            {active.length} de {maxStreams} dispositivo(s) simultâneo(s) em uso
          </p>

          {current && (
            <>
              <p className="text-xs text-slate-500 mb-1.5">Dispositivo atual</p>
              <div className="flex items-center gap-3 rounded-lg bg-white/5 border border-purple-500/30 px-4 py-3 mb-3">
                <Smartphone className="w-4 h-4 text-purple-300 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {current.device_name || 'Este dispositivo'}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-semibold">
                      Atual
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Última atividade: {formatWhen(current.last_heartbeat)}
                    {current.ip ? ` · IP: ${current.ip}` : ''}
                  </p>
                </div>
              </div>
            </>
          )}

          {others.length > 0 && (
            <>
              <p className="text-xs text-slate-500 mb-1.5">Outros dispositivos</p>
              <div className="space-y-2 mb-4">
                {others.map((d) => (
                  <div
                    key={d.device_id}
                    className="flex items-center gap-3 rounded-lg bg-white/5 border border-slate-800 px-4 py-3"
                  >
                    <Smartphone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-white">
                        {d.device_name || 'Dispositivo'}
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Última atividade: {formatWhen(d.last_heartbeat)}
                        {d.ip ? ` · IP: ${d.ip}` : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleRevoke(d.device_id)}
                      disabled={busyId === d.device_id}
                      className="text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-500/40 rounded-full h-8 px-3 text-xs flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {busyId === d.device_id ? 'Removendo…' : 'Remover'}
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                onClick={handleRevokeAll}
                disabled={busyId === 'all'}
                className="w-full bg-red-600/90 hover:bg-red-600 text-white"
              >
                {busyId === 'all' ? 'Desconectando…' : 'Desconectar todos os outros dispositivos'}
              </Button>
              <p className="text-xs text-slate-500 mt-2 text-center">
                Isso encerra a sessão dos outros dispositivos, mantendo apenas este ativo.
              </p>
            </>
          )}

          {others.length === 0 && current && (
            <p className="text-xs text-slate-500">
              Nenhum outro dispositivo assistindo com essa conta no momento.
            </p>
          )}

          <p className="text-xs text-slate-500 mt-4 pt-4 border-t border-slate-800">
            Seu plano permite {maxStreams} dispositivo{maxStreams > 1 ? 's' : ''} simultâneo
            {maxStreams > 1 ? 's' : ''}.
          </p>
        </>
      )}
    </div>
  );
}

// ✅ 07/08 — TESTE: mesmo gate do BottomNav.jsx, só pra reservar espaço
// embaixo pro tesagencia não ter a barra cobrindo o final da página.
const BOTTOM_NAV_TEST_EMAIL = "tesagencia@gmail.com";

const MinhaConta = () => {
  const { user } = useAuth();
  const showBottomNav = user?.email === BOTTOM_NAV_TEST_EMAIL;

  return (
    <>
      <Helmet>
        <title>Configurações | DoramasPlus</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-50">
        <Navbar />

        <main
          className={`container mx-auto px-4 sm:px-6 lg:px-8 pt-24 ${
            showBottomNav ? "pb-28" : "pb-16"
          }`}
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="max-w-2xl mx-auto space-y-4"
          >
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Configurações</h1>
              <p className="text-sm text-slate-400">Gerencie sua conta e preferências.</p>
            </div>

            <PedirDoramaCard user={user} />
            {showBottomNav ? (
              <>
                <IndicacaoCard user={user} />
                <PlanoCard user={user} />
              </>
            ) : (
              <>
                <PlanoCard user={user} />
                <IndicacaoCard user={user} />
              </>
            )}
            <ContaCard user={user} />
            <SenhaCard />
            <DispositivosCard />

            <Link
              to="/privacidade"
              className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 hover:bg-slate-900 transition"
            >
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-slate-400" />
                <p className="text-sm font-semibold">Política de Privacidade</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
            </Link>

            {showBottomNav && <SairContaCard />}
            <ExcluirContaCard />
          </motion.div>
        </main>
      </div>
    </>
  );
};

export default MinhaConta;
