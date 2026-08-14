// Modo Espelho (14/08/2026) — transmissor do lado do CLIENTE.
//
// Só entra em ação pro usuário que o admin marcou em live_mirror_flags
// (RLS: cada um só lê a própria chave). Custo pro tráfego normal: uma
// consulta leve pós-load+idle e re-checagem a cada 20s (só com a aba
// visível) + checagem imediata quando o app volta a ficar visível.
// O rrweb (parte pesada) só é baixado por import dinâmico quando a chave
// está ligada — não engorda o bundle nem o INP de ninguém.
//
// PRESENÇA (14/08 v2): a gravação só roda ENQUANTO o admin está com a
// página do Espelho aberta (presence no canal). Admin saiu/fechou/caiu →
// 15s de tolerância → transmissão para sozinha. Chave com mais de 2h sem
// atualização é tratada como esquecida (auto-expira do lado do cliente).
//
// Transporte: Supabase Realtime BROADCAST (canal efêmero `mirror-<uuid>`,
// pub/sub puro — NÃO toca banco/WAL). Lotes de 1s fatiados em ~100KB.
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
      .select('enabled, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data?.enabled) return false;
    // chave esquecida acesa não vale pra sempre: expira em 2h
    const ts = Date.parse(data.updated_at);
    if (Number.isFinite(ts) && Date.now() - ts > 2 * 60 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

async function startStreaming(userId, onStopped) {
  if (streaming) return;
  streaming = true;
  try {
    const rrweb = await import('rrweb');
    const channel = supabase.channel(`mirror-${userId}`, {
      config: { presence: { key: `c-${Math.random().toString(36).slice(2, 8)}` } },
    });
    let queue = [];
    let stopRecord = null;
    let flushTimer = null;
    let recording = false;
    let stopGrace = null;
    let idleGuard = null;

    const pauseRec = () => {
      recording = false;
      try {
        if (stopRecord) stopRecord();
      } catch {}
      stopRecord = null;
      if (flushTimer) clearInterval(flushTimer);
      flushTimer = null;
      queue = [];
    };

    const stopAll = () => {
      pauseRec();
      try {
        if (stopGrace) clearTimeout(stopGrace);
        if (idleGuard) clearTimeout(idleGuard);
        supabase.removeChannel(channel);
      } catch {}
      streaming = false;
      // volta pra vigília: se o admin religar depois, retoma sozinho
      if (onStopped) onStopped();
    };

    const startRec = () => {
      if (recording) return;
      recording = true;
      if (idleGuard) {
        clearTimeout(idleGuard);
        idleGuard = null;
      }
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
    };

    const adminPresente = () => {
      try {
        const st = channel.presenceState();
        return Object.values(st).some((metas) =>
          (metas || []).some((m) => m.role === 'admin')
        );
      } catch {
        return false;
      }
    };

    channel
      // grava SÓ com o admin olhando; ele sumiu 15s → para sozinho
      .on('presence', { event: 'sync' }, () => {
        if (adminPresente()) {
          if (stopGrace) {
            clearTimeout(stopGrace);
            stopGrace = null;
          }
          startRec();
        } else if (recording && !stopGrace) {
          stopGrace = setTimeout(() => {
            stopGrace = null;
            if (!adminPresente()) stopAll();
          }, 15000);
        }
      })
      // admin pede um snapshot novo (entrou atrasado na transmissão)
      .on('broadcast', { event: 'resnap' }, () => {
        try {
          rrweb.record.takeFullSnapshot(true);
        } catch {}
      })
      // admin desligou a chave — para tudo na hora
      .on('broadcast', { event: 'stop' }, stopAll)
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // se ninguém aparecer pra assistir em 3min, desiste (evita canal
        // aberto à toa por chave esquecida)
        idleGuard = setTimeout(() => {
          if (!recording) stopAll();
        }, 180000);
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
        startStreaming(userId, () => {});
      }
    };
    await tick();
    // 20s de vigília + checagem imediata quando a pessoa volta pro app
    setInterval(tick, 20000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();
    });
  } catch {
    /* espelho nunca pode quebrar a página */
  }
}
