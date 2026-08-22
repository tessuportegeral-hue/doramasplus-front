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
  aguardando: { label: 'Aguardando (na fila)', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  indeterminado: { label: 'Tempo indeterminado', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/40' },
  dispensado: { label: 'Não tenho (avisado)', cls: 'bg-slate-600/20 text-slate-400 border-slate-600/40' },
};

const pct = (s) => (s == null ? '' : `${Math.round(Number(s) * 100)}%`);

const fmtData = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
};

const fmtDataHora = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, cls: 'bg-slate-700/30 text-slate-300 border-slate-600/40' };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function MatchCard({ m, onAcao, busy }) {
  const temCandidato = !!m.candidate_link;
  const [linkMode, setLinkMode] = useState(false);
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  const buscarCatalogo = async (texto) => {
    setQ(texto);
    if (texto.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    try {
      const { data } = await supabase
        .from('doramas')
        .select('id, title, slug')
        .ilike('title', `%${texto.trim()}%`)
        .limit(8);
      setResultados(data || []);
    } catch {
      setResultados([]);
    }
    setBuscando(false);
  };
  const acionavel = ['duvidoso', 'achei', 'nao_achei', 'erro'].includes(m.status);
  const dataTxt =
    m.primeiro_em && m.ultimo_em && fmtData(m.primeiro_em) !== fmtData(m.ultimo_em)
      ? `pedido entre ${fmtData(m.primeiro_em)} e ${fmtData(m.ultimo_em)}`
      : m.ultimo_em
      ? `pedido em ${fmtData(m.ultimo_em)}`
      : '';
  const btnOutline =
    'h-8 border-slate-700 text-slate-300 hover:bg-slate-800';
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
          {dataTxt && <p className="text-xs text-slate-500 mt-1">🗓️ {dataTxt}</p>}
          {m.note && <p className="text-xs text-orange-300 mt-1">⚠️ {m.note}</p>}
          {m.candidate_caption && (
            <p className="text-sm text-slate-400 mt-1 break-words">
              Candidato: <span className="text-slate-300">{m.candidate_caption}</span>
            </p>
          )}
          {Array.isArray(m.pessoas) && m.pessoas.length > 0 && (
            <div className="mt-2 border-t border-slate-800 pt-2 space-y-1">
              {m.pessoas.map((p, i) => (
                <div key={i} className="text-xs text-slate-400 break-words">
                  <span className="text-slate-200 font-medium">{p.nome || 'Sem nome'}</span>
                  {p.email && <span> · {p.email}</span>}
                  {p.telefone && <span> · 📞 {p.telefone}</span>}
                  <span className="text-slate-500"> · pediu {fmtDataHora(p.pedido_em)}</span>
                  {p.entregue_em && (
                    <span className="text-emerald-400"> · ✓ entregue {fmtDataHora(p.entregue_em)}</span>
                  )}
                </div>
              ))}
            </div>
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
        {acionavel && (
          <>
            {temCandidato && m.status === 'duvidoso' && (
              <Button size="sm" disabled={busy} onClick={() => onAcao(m, 'approve')} className="bg-emerald-600 hover:bg-emerald-500 h-8">
                <Check className="w-4 h-4 mr-1" /> Aprovar (subir)
              </Button>
            )}
            {m.status === 'achei' && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onAcao(m, 'reject')} className={btnOutline}>
                <X className="w-4 h-4 mr-1" /> Cancelar (não subir)
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAcao(m, 'set_aguardando')} className={btnOutline}>
              Aguardando
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAcao(m, 'set_indeterminado')} className={btnOutline}>
              Tempo indeterminado
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAcao(m, 'dismiss')} className={btnOutline}>
              Não tenho
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setLinkMode((v) => !v)}
              className="h-8 border-purple-600/50 text-purple-300 hover:bg-purple-600/10"
            >
              Já tenho (linkar)
            </Button>
          </>
        )}
      </div>

      {linkMode && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-400 mb-2">
            Busca no teu catálogo e clica pra linkar esse pedido ao dorama que você já tem (avisa a pessoa que chegou):
          </p>
          <input
            type="text"
            value={q}
            onChange={(e) => buscarCatalogo(e.target.value)}
            placeholder="Buscar título no catálogo..."
            className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
          {buscando && <p className="text-xs text-slate-500 mt-2">Buscando...</p>}
          {resultados.length > 0 && (
            <div className="mt-2 space-y-1 max-h-52 overflow-y-auto">
              {resultados.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onAcao(m, 'link_dorama', { dorama_id: d.id });
                    setLinkMode(false);
                    setQ('');
                    setResultados([]);
                  }}
                  className="w-full text-left text-sm text-slate-200 bg-slate-800/60 hover:bg-purple-600/20 border border-slate-700 rounded-md px-3 py-1.5"
                >
                  {d.title}
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !buscando && resultados.length === 0 && (
            <p className="text-xs text-slate-500 mt-2">Nenhum dorama com esse nome no catálogo.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Paginador({ pag, totalPags, setPag }) {
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button
        onClick={() => setPag((p) => Math.max(1, p - 1))}
        disabled={pag <= 1}
        className="text-xs px-3 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
      >
        ← Anterior
      </button>
      <span className="text-xs text-slate-400">Página {pag} de {totalPags}</span>
      <button
        onClick={() => setPag((p) => Math.min(totalPags, p + 1))}
        disabled={pag >= totalPags}
        className="text-xs px-3 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
      >
        Próxima →
      </button>
    </div>
  );
}

// Seção com paginação de 10 em 10 (pros grandes: entregues, não achei, indeterminado...)
function SecaoPaginada({ id, titulo, itens, dica, renderItem, pageSize = 10 }) {
  const [pag, setPag] = useState(1);
  if (!itens.length) return null;
  const totalPags = Math.ceil(itens.length / pageSize);
  const p = Math.min(pag, totalPags);
  const slice = itens.slice((p - 1) * pageSize, p * pageSize);
  return (
    <section id={id} className="mb-8 scroll-mt-4">
      <h2 className="text-lg font-semibold text-slate-100 mb-1">
        {titulo} <span className="text-slate-500 text-sm">({itens.length})</span>
      </h2>
      {dica && <p className="text-sm text-slate-500 mb-3">{dica}</p>}
      <div className="grid gap-3 md:grid-cols-2">{slice.map(renderItem)}</div>
      {totalPags > 1 && <Paginador pag={p} totalPags={totalPags} setPag={setPag} />}
    </section>
  );
}

export default function AdminPedidos() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isAuthorized = !authLoading && user?.email === ADMIN_EMAIL;

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState([]);
  const [indeterminados, setIndeterminados] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const carregar = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setMatches([]);
        setIndeterminados([]);
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
      setIndeterminados(data.indeterminados || []);
    } catch (e) {
      if (!silent) toast({ title: 'Erro ao carregar', description: String(e), variant: 'destructive' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthorized) navigate('/');
      else carregar();
    }
  }, [authLoading, isAuthorized, navigate, carregar]);

  // atualiza sozinho a cada 20s (silencioso) pra acompanhar os uploads ao vivo
  useEffect(() => {
    if (!isAuthorized) return;
    const t = setInterval(() => carregar(true), 20000);
    return () => clearInterval(t);
  }, [isAuthorized, carregar]);

  const decidir = async (m, action, extra = {}) => {
    setBusyId(m.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, id: m.id, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'falha');
      setMatches((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: data.status } : x)));
      const LABEL = {
        approve: 'Aprovado ✓ (vai subir)',
        reject: 'Cancelado',
        set_aguardando: 'Marcado como aguardando — pessoa avisada',
        set_indeterminado: 'Tempo indeterminado — pessoa avisada',
        dismiss: 'Marcado "não tenho" — pessoa avisada',
        link_dorama: 'Linkado ao dorama — pessoa avisada que chegou',
      };
      toast({ title: LABEL[action] || 'Feito', description: m.dorama_name });
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
    aguardando: matches.filter((m) => m.status === 'aguardando'),
    nao_achei: matches.filter((m) => m.status === 'nao_achei'),
    dispensado: matches.filter((m) => ['dispensado', 'recusado'].includes(m.status)),
  };

  const irPara = (id) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const Secao = ({ id, titulo, itens, dica }) =>
    itens.length > 0 && (
      <section id={id} className="mb-8 scroll-mt-4">
        <h2 className="text-lg font-semibold text-slate-100 mb-1">
          {titulo} <span className="text-slate-500 text-sm">({itens.length})</span>
        </h2>
        {dica && <p className="text-sm text-slate-500 mb-3">{dica}</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {itens.map((m) => (
            <MatchCard key={m.id} m={m} busy={busyId === m.id} onAcao={decidir} />
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
            {/* atalhos: pula direto pra seção — com mt dorama, evita rolar tudo */}
            <div className="flex flex-wrap gap-2 mb-6 sticky top-0 z-20 bg-slate-950/95 backdrop-blur py-2">
              {grupos.duvidoso.length > 0 && (
                <button onClick={() => irPara('sec-duvidoso')} className="text-xs px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800">❓ Confere ({grupos.duvidoso.length})</button>
              )}
              {grupos.achei.length > 0 && (
                <button onClick={() => irPara('sec-achei')} className="text-xs px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800">✅ Alta confiança ({grupos.achei.length})</button>
              )}
              {grupos.fila.length > 0 && (
                <button onClick={() => irPara('sec-fila')} className="text-xs px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800">🚀 Fila ({grupos.fila.length})</button>
              )}
              {grupos.aguardando.length > 0 && (
                <button onClick={() => irPara('sec-aguardando')} className="text-xs px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800">⏳ Aguardando ({grupos.aguardando.length})</button>
              )}
              {indeterminados.length > 0 && (
                <button onClick={() => irPara('sec-indeterminado')} className="text-xs px-2.5 py-1 rounded-full border border-orange-500/50 text-orange-200 bg-orange-500/15 hover:bg-orange-500/25 font-semibold">🕓 Tempo indeterminado ({indeterminados.length})</button>
              )}
              {grupos.nao_achei.length > 0 && (
                <button onClick={() => irPara('sec-nao-achei')} className="text-xs px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800">❌ Não achei ({grupos.nao_achei.length})</button>
              )}
              {grupos.subido.length > 0 && (
                <button onClick={() => irPara('sec-subido')} className="text-xs px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800">🎉 Entregues ({grupos.subido.length})</button>
              )}
              {grupos.dispensado.length > 0 && (
                <button onClick={() => irPara('sec-dispensado')} className="text-xs px-2.5 py-1 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800">🚫 Rejeitados ({grupos.dispensado.length})</button>
              )}
            </div>
            <Secao
              id="sec-duvidoso"
              titulo="❓ Confere na mão"
              itens={grupos.duvidoso}
              dica="O bot achou algo parecido mas não tem certeza. Confere o link e aprove só se for o dorama certo."
            />
            <Secao
              id="sec-achei"
              titulo="✅ Alta confiança (sobem sozinhos)"
              itens={grupos.achei}
              dica="Match quase exato. Vão subir automaticamente com o Vision confirmando a capa. Se algum estiver errado, recuse."
            />
            <Secao id="sec-fila" titulo="🚀 Na fila do bot" itens={grupos.fila} />
            <SecaoPaginada
              id="sec-subido"
              titulo="🎉 Entregues (histórico)"
              itens={grupos.subido}
              dica="Já subidos/disponíveis. Mostra quem pediu e a hora que foi entregue."
              renderItem={(m) => <MatchCard key={m.id} m={m} busy={busyId === m.id} onAcao={decidir} />}
            />
            <SecaoPaginada
              id="sec-nao-achei"
              titulo="❌ Não achei (garimpo manual)"
              itens={grupos.nao_achei}
              dica="Não tem no grupo da menina (ou a pessoa escreveu muito diferente). Você acha na mão — e pode marcar Aguardando / Tempo indeterminado / Não tenho pra avisar quem pediu."
              renderItem={(m) => <MatchCard key={m.id} m={m} busy={busyId === m.id} onAcao={decidir} />}
            />
            <Secao
              id="sec-aguardando"
              titulo="⏳ Aguardando (você marcou)"
              itens={grupos.aguardando}
              dica="Marcados manualmente como na fila. Se a menina postar, o bot acha e sobe sozinho."
            />
            <SecaoPaginada
              id="sec-indeterminado"
              titulo="🕓 Tempo indeterminado"
              itens={indeterminados}
              dica={'Todos os pedidos marcados como "sem previsão" (a pessoa já foi avisada). Se algum aparecer no grupo depois, o bot pega sozinho e vira aguardando.'}
              renderItem={(g) => (
                <div key={g.dorama_name} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-100 break-words">{g.dorama_name}</span>
                        {g.qtd > 1 && (
                          <span className="inline-flex items-center gap-1 text-xs text-purple-300 bg-purple-500/10 border border-purple-500/30 px-1.5 py-0.5 rounded-full">
                            <Users className="w-3 h-3" /> {g.qtd} pessoas
                          </span>
                        )}
                      </div>
                      {g.marcado_em && (
                        <p className="text-xs text-slate-500 mt-1">🕓 marcado {fmtDataHora(g.marcado_em)}</p>
                      )}
                      {Array.isArray(g.pessoas) && g.pessoas.length > 0 && (
                        <div className="mt-2 border-t border-slate-800 pt-2 space-y-1">
                          {g.pessoas.map((p, i) => (
                            <div key={i} className="text-xs text-slate-400 break-words">
                              <span className="text-slate-200 font-medium">{p.nome || 'Sem nome'}</span>
                              {p.email && <span> · {p.email}</span>}
                              {p.telefone && <span> · 📞 {p.telefone}</span>}
                              <span className="text-slate-500"> · pediu {fmtDataHora(p.pedido_em)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <StatusBadge status="indeterminado" />
                  </div>
                </div>
              )}
            />
            <SecaoPaginada
              id="sec-dispensado"
              titulo="🚫 Rejeitados (histórico)"
              itens={grupos.dispensado}
              dica="Descartados ('não tenho') ou recusados. Mostra quem tinha pedido."
              renderItem={(m) => <MatchCard key={m.id} m={m} busy={busyId === m.id} onAcao={decidir} />}
            />
          </>
        )}
      </div>
    </div>
  );
}
