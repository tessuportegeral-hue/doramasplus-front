// Modo Espelho (14/08/2026) — transmissor do lado do CLIENTE.
//
// Só entra em ação pro usuário que o admin marcou em live_mirror_flags
// (RLS: cada um só lê a própria chave). Custo pro tráfego normal: uma
// consulta leve pós-load+idle e depois 1 re-checagem por minuto (só com a
// aba visível — mesmo espírito do heartbeat de 3s que o /watch já faz).
// Assim o admin liga a chave no painel e a transmissão começa SOZINHA em
// até ~60s, sem pedir pro cliente recarregar. O rrweb (parte pesada) só é
// baixado por import dinâmico quando a chave está ligada — não engorda o
// bundle nem o INP de ninguém (lição do fbevents).
//
// Transporte: Supabase Realtime BROADCAST (canal efêmero `mirror-<uuid>`,
// pub/sub puro — NÃO toca banco/WAL, nada a ver com o incidente do
// playback_sessions). Lotes a cada 1s, fatiados em pedaços de ~100KB.
import { supabase } from '@/lib/supabaseClient';

let booted = false;
let streaming = false;

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

async function flagLigada(userId) {
  try {
    const { data } = await supabase
      .from('live_mirror_flags')
      .select('enabled')
      .eq('user_id', userId)
      .maybeSingle();
    return !!data?.enabled;
  } catch {
    return false;
  }
}

async function startStreaming(userId, onStopped) {
  if (streaming) return;
  streaming = true;
  try {
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
      streaming = false;
      // volta pra vigília: se o admin religar depois, retoma sozinho
      if (onStopped) onStopped();
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
    streaming = false;
  }
}

export async function initLiveMirror(userId) {
  if (booted || !userId) return;
  booted = true;
  try {
    const tick = async () => {
      if (streaming) return;
      if (document.visibilityState !== 'visible') return;
      if (await flagLigada(userId)) {
        startStreaming(userId, () => {
          /* stopAll já devolveu streaming=false; o intervalo segue vigiando */
        });
      }
    };
    await tick();
    // 20s de vigília (consulta por PK, mais leve que o heartbeat de 3s do
    // /watch) + checagem IMEDIATA quando a pessoa volta pro app (no celular
    // "abrir o app de novo" costuma ser só a aba voltando a ficar visível).
    setInterval(tick, 20000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();
    });
  } catch {
    /* espelho nunca pode quebrar a página */
  }
}
