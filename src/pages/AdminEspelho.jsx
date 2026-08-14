// Modo Espelho (14/08/2026) — lado do ADMIN.
// Fluxo: digita o e-mail do cliente → "Ligar espelho" grava a chave
// (RPC admin_mirror_set, só is_admin executa) e assina o canal
// mirror-<user_id>. Quando o cliente abrir o site, o app dele começa a
// transmitir (src/lib/liveMirror.js) e a tela aparece aqui ao vivo.
// "Desligar" apaga a chave e manda um broadcast que interrompe a
// transmissão do lado do cliente na hora.
import React, { useEffect, useRef, useState } from 'react';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Monitor, Power, Loader2 } from 'lucide-react';

const AdminEspelho = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('parado'); // parado | ligando | aguardando | transmitindo
  const [info, setInfo] = useState('');
  const containerRef = useRef(null);
  const stRef = useRef({ channel: null, replayer: null, buffer: [], parts: {}, userId: null });

  const cleanup = () => {
    const st = stRef.current;
    try {
      if (st.channel) supabase.removeChannel(st.channel);
    } catch {}
    try {
      if (st.replayer && st.replayer.destroy) st.replayer.destroy();
    } catch {}
    if (containerRef.current) containerRef.current.innerHTML = '';
    stRef.current = { channel: null, replayer: null, buffer: [], parts: {}, userId: null };
  };

  useEffect(() => () => cleanup(), []);

  const handleEvent = (e) => {
    const st = stRef.current;
    try {
      if (!st.replayer) {
        st.buffer.push(e);
        // precisa do par meta (type 4) + snapshot completo (type 2) pra abrir
        const hasMeta = st.buffer.some((ev) => ev.type === 4);
        const hasSnap = st.buffer.some((ev) => ev.type === 2);
        if (hasMeta && hasSnap) {
          const r = new Replayer(st.buffer, {
            liveMode: true,
            root: containerRef.current,
          });
          r.startLive(st.buffer[0].timestamp);
          st.replayer = r;
          setStatus('transmitindo');
        }
      } else {
        st.replayer.addEvent(e);
      }
    } catch {}
  };

  const onEvts = (payload) => {
    const st = stRef.current;
    const { id, i, total, part } = payload || {};
    if (id == null) return;
    const p = st.parts[id] || (st.parts[id] = { total, got: 0, arr: [] });
    if (p.arr[i] == null) {
      p.arr[i] = part;
      p.got += 1;
    }
    if (p.got === p.total) {
      delete st.parts[id];
      let events;
      try {
        events = JSON.parse(p.arr.join(''));
      } catch {
        return;
      }
      events.forEach(handleEvent);
    }
  };

  const ligar = async () => {
    if (!email.trim()) return;
    cleanup();
    setInfo('');
    setStatus('ligando');
    const { data, error } = await supabase.rpc('admin_mirror_set', {
      p_email: email,
      p_enabled: true,
    });
    if (error || !data?.ok) {
      setStatus('parado');
      setInfo(
        error
          ? `Erro: ${error.message}`
          : 'E-mail não encontrado no cadastro.'
      );
      return;
    }
    stRef.current.userId = data.user_id;
    setInfo(`Espelho LIGADO para ${data.name || email}. Peça pro cliente abrir o site (ou recarregar) — a tela aparece aqui.`);
    const ch = supabase.channel(`mirror-${data.user_id}`);
    ch.on('broadcast', { event: 'evts' }, ({ payload }) => onEvts(payload)).subscribe(
      (s) => {
        if (s === 'SUBSCRIBED') {
          setStatus('aguardando');
          // se o cliente JÁ estiver transmitindo, pede um snapshot novo
          ch.send({ type: 'broadcast', event: 'resnap', payload: {} });
        }
      }
    );
    stRef.current.channel = ch;
  };

  const desligar = async () => {
    try {
      if (stRef.current.channel) {
        stRef.current.channel.send({ type: 'broadcast', event: 'stop', payload: {} });
      }
    } catch {}
    await supabase.rpc('admin_mirror_set', { p_email: email, p_enabled: false }).catch?.(() => {});
    cleanup();
    setStatus('parado');
    setInfo('Espelho desligado.');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Monitor className="w-7 h-7 text-purple-400" />
          <h1 className="text-2xl font-bold">Modo Espelho — ver a tela do cliente ao vivo</h1>
        </div>

        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail do cliente"
            className="flex-1 h-11 rounded-lg bg-slate-900 border border-slate-800 px-3 text-slate-100 placeholder:text-slate-500 outline-none focus:border-purple-500/60"
          />
          <Button
            onClick={ligar}
            disabled={status === 'ligando' || !email.trim()}
            className="bg-purple-600 hover:bg-purple-700 h-11"
          >
            {status === 'ligando' ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Monitor className="w-4 h-4 mr-2" />
            )}
            Ligar espelho
          </Button>
          <Button
            onClick={desligar}
            variant="outline"
            className="h-11 bg-slate-900 border-slate-700 hover:bg-slate-800 text-red-400"
          >
            <Power className="w-4 h-4 mr-2" /> Desligar
          </Button>
        </div>

        {info && <p className="text-sm text-slate-300">{info}</p>}

        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              status === 'transmitindo'
                ? 'bg-green-500 animate-pulse'
                : status === 'aguardando'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-slate-600'
            }`}
          />
          {status === 'transmitindo'
            ? 'AO VIVO — recebendo a tela do cliente'
            : status === 'aguardando'
            ? 'Aguardando o cliente abrir o site…'
            : 'Parado'}
        </div>

        <div
          ref={containerRef}
          className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-auto min-h-[420px] [&_iframe]:pointer-events-none"
        />

        <p className="text-xs text-slate-500">
          O vídeo do player não aparece no espelho (limitação técnica) — mas toda a
          navegação, telas, loadings e erros aparecem. Campos digitados vêm
          mascarados. Lembre de DESLIGAR ao terminar o atendimento.
        </p>
      </div>
    </div>
  );
};

export default AdminEspelho;
