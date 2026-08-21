import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Helmet } from 'react-helmet';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useNavigate } from 'react-router-dom';
import AdminTabs from '@/components/AdminTabs';
import {
  ArrowLeft,
  RefreshCw,
  Check,
  X,
  ExternalLink,
  Users,
  Search as SearchIcon,
} from 'lucide-react';

const ADMIN_EMAIL = 'tessuportegeral@gmail.com';
const FN_URL = 'https://fbngdxhkaueaolnyswgn.supabase.co/functions/v1/admin-bot-matches';

// Rótulo + cor de cada status
const STATUS_META = {
  duvidoso: { label: 'Confere na mão', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  achei: { label: 'Alta confiança — sobe sozinho', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  aprovado: { label: 'Aprovado — na fila do bot', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  subindo: { label: 'Subindo...', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  subido: { label: 'Subido ✓', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  recusado: { label: 'Recusado', cls: 'bg-slate-600/20 text-slate-400 border-slate-600/40' },
  nao_achei: { label: 'Não achei', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  erro: { label: 'Erro', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
};

const pct = (s) => (s == null ? '' : `${Math.round(Number(s) * 100)}%`);

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, cls: 'bg-slate-700/30 text-slate-300 border-slate-600/40' };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function MatchCard({ m, onApprove, onReject, busy }) {
  const temCandidato = !!m.candidate_link;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-100 break-words">{m.dorama_name}</span>
            {m.pedidos_count > 1 && (
              <span className="inline-flex items-center gap-1 text-xs text-purple-300 bg-purple-500/10 border border-purple-500/30 px-1.5 py-0.5 rounded-full">
                <Users className="w-3 h-3" /> {m.pedidos_count} pessoas
              </span>
            )}
            {m.lang_pedida && (
              <span className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                pediram {m.lang_pedida}
              </span>
            )}
            {m.score != null && (
              <span className="text-xs text-slate-400">match {pct(m.score)}</span>
            )}
          </div>
          {m.candidate_caption && (
            <p className="text-sm text-slate-400 mt-1 break-words">
              Candidato: <span className="text-slate-300">{m.candidate_caption}</span>
            </p>
          )}
        </div>
        <StatusBadge status={m.status} />
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {temCandidato && (
          <a
            href={m.candidate_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-sky-300 hover:text-sky-200 border border-sky-500/30 rounded-md px-2.5 py-1"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Ver no Telegram
          </a>
        )}
        {['duvidoso', 'achei', 'nao_achei', 'erro'].includes(m.status) && (
          <>
            {temCandidato && m.status === 'duvidoso' && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onApprove(m)}
                className="bg-emerald-600 hover:bg-emerald-500 h-8"
              >
                <Check className="w-4 h-4 mr-1" /> Aprovar (subir)
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onReject(m)}
              className="h-8 border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <X className="w-4 h-4 mr-1" />
              {m.status === 'achei' ? 'Cancelar (não subir)' : temCandidato ? 'Recusar' : 'Dispensar'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminPedidos() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isAuthorized = !authLoading && user?.email === ADMIN_EMAIL;

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setMatches([]);
        return;
      }
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'list' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'falha ao listar');
      setMatches(data.matches || []);
    } catch (e) {
      toast({ title: 'Erro ao carregar', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthorized) navigate('/');
      else carregar();
    }
  }, [authLoading, isAuthorized, navigate, carregar]);

  const decidir = async (m, action) => {
    setBusyId(m.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, id: m.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'falha');
      setMatches((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: data.status } : x)));
      toast({ title: action === 'approve' ? 'Aprovado ✓' : 'Recusado', description: m.dorama_name });
    } catch (e) {
      toast({ title: 'Erro', description: String(e), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const grupos = {
    duvidoso: matches.filter((m) => m.status === 'duvidoso'),
    achei: matches.filter((m) => m.status === 'achei'),
    fila: matches.filter((m) => ['aprovado', 'subindo'].includes(m.status)),
    subido: matches.filter((m) => m.status === 'subido'),
    nao_achei: matches.filter((m) => m.status === 'nao_achei'),
    recusado: matches.filter((m) => m.status === 'recusado'),
  };

  const Secao = ({ titulo, itens, dica }) =>
    itens.length > 0 && (
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">
          {titulo} <span className="text-slate-500 text-sm">({itens.length})</span>
        </h2>
        {dica && <p className="text-sm text-slate-500 mb-3">{dica}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {itens.map((m) => (
            <MatchCard
              key={m.id}
              m={m}
              busy={busyId === m.id}
              onApprove={(x) => decidir(x, 'approve')}
              onReject={(x) => decidir(x, 'reject')}
            />
          ))}
        </div>
      </section>
    );

  if (authLoading || !isAuthorized) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Verificando permissão...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <Helmet><title>Pedidos — Admin DoramasPlus</title></Helmet>
      <AdminTabs />
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-slate-200">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <SearchIcon className="w-6 h-6 text-purple-400" /> Pedidos (busca do bot)
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={carregar}
            disabled={loading}
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>

        <p className="text-sm text-slate-500 mt-2 mb-6">
          O bot procura os pedidos pendentes no grupo VIP ARQUIVOS. Os de <b>alta confiança</b> sobem
          sozinhos (com o Vision confirmando a capa). Os <b>duvidosos</b> aparecem aqui pra você aprovar
          ou recusar. Rode <code className="text-slate-400">/buscar</code> no grupo do bot pra atualizar a lista.
        </p>

        {loading && matches.length === 0 ? (
          <p className="text-slate-500">Carregando...</p>
        ) : matches.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-center text-slate-400">
            Nenhum pedido processado ainda. Mande <code className="text-slate-300">/buscar</code> no grupo do bot.
          </div>
        ) : (
          <>
            <Secao
              titulo="❓ Confere na mão"
              itens={grupos.duvidoso}
              dica="O bot achou algo parecido mas não tem certeza. Confere o link e aprove só se for o dorama certo."
            />
            <Secao
              titulo="✅ Alta confiança (sobem sozinhos)"
              itens={grupos.achei}
              dica="Match quase exato. Vão subir automaticamente com o Vision confirmando a capa. Se algum estiver errado, recuse."
            />
            <Secao titulo="🚀 Na fila do bot" itens={grupos.fila} />
            <Secao titulo="🎉 Já subidos" itens={grupos.subido} />
            <Secao
              titulo="❌ Não achei (garimpo manual)"
              itens={grupos.nao_achei}
              dica="Não tem no grupo da menina (ou o nome está muito diferente). Precisa você achar na mão."
            />
            <Secao titulo="🗑️ Recusados" itens={grupos.recusado} />
          </>
        )}
      </div>
    </div>
  );
}
