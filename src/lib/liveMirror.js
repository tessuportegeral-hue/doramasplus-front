// Modo Espelho (14/08/2026) — transmissor do lado do CLIENTE.
//
// Só entra em ação pro usuário que o admin marcou em live_mirror_flags
// (RLS: cada um só lê a própria chave). Pra todo o resto do tráfego o custo
// é UMA consulta leve por sessão, feita depois do load+idle — o rrweb (a
// parte pesada) só é baixado por import dinâmico se a chave estiver ligada,
// então não engorda o bundle nem o INP de ninguém (lição do fbevents).
//
// Transporte: Supabase Realtime BROADCAST (canal efêmero `mirror-<uuid>`,
// pub/sub puro — NÃO toca banco/WAL, nada a ver com o incidente do
// playback_sessions). Lotes a cada 1s, fatiados em pedaços de ~100KB
// (o snapshot inicial do DOM pode ser grande).
import { supabase } from '@/lib/supabaseClient';

let started = false;

function sendChunked(channel, events) {
  try {
    const str = JSON.stringify(events);
    const MAX = 100000;
    const total = Math.ceil(str.length / MAX) || 1;
    const id = Math.random().toString(36).slice(2, 10);
    for (let i = 0; i < total; i++) {
      channel.send({
        type: 'broadcast',
        event: 'evts',
        payload: { id, i, total, part: str.slice(i * MAX, (i + 1) * MAX) },
      });
    }
  } catch {
    /* espelho nunca pode quebrar a página */
  }
}

export async function initLiveMirror(userId) {
  if (started || !userId) return;
  started = true;
  try {
    const { data } = await supabase
      .from('live_mirror_flags')
      .select('enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data?.enabled) return;

    const rrweb = await import('rrweb');
    const channel = supabase.channel(`mirror-${userId}`);
    let queue = [];
    let stopRecord = null;
    let flushTimer = null;

    const stopAll = () => {
      try {
        if (stopRecord) stopRecord();
        if (flushTimer) clearInterval(flushTimer);
        supabase.removeChannel(channel);
      } catch {}
    };

    channel
      // admin pede um snapshot novo (entrou atrasado na transmissão)
      .on('broadcast', { event: 'resnap' }, () => {
        try {
          rrweb.record.takeFullSnapshot(true);
        } catch {}
      })
      // admin desligou a chave — para tudo na hora
      .on('broadcast', { event: 'stop' }, stopAll)
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED' || stopRecord) return;
        stopRecord = rrweb.record({
          emit(event) {
            queue.push(event);
          },
          maskAllInputs: true,
          sampling: { mousemove: 200, scroll: 150, media: 800 },
        });
        flushTimer = setInterval(() => {
          if (!queue.length) return;
          const batch = queue;
          queue = [];
          sendChunked(channel, batch);
        }, 1000);
      });
  } catch {
    /* espelho nunca pode quebrar a página */
  }
}
