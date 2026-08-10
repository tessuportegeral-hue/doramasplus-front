import { useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { isPushSupported, getNotificationPermission, subscribeToPush, ensureSubscriptionSynced } from '@/lib/pushNotifications';

const DISMISS_KEY = 'dp_push_prompt_dismissed_at';
// ✅ 10/08: banner volta a aparecer depois de alguns dias em vez de nunca
// mais — "agora não" não é "nunca", e a maioria só precisa de mais de uma
// chance pra decidir. Recusa real (permissão negada no navegador) continua
// bloqueada pra sempre, isso aqui só controla o NOSSO banner.
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

// ✅ 09/08: registra cada etapa do funil (mostrou, aceitou, recusou, negou
// no navegador, falhou tecnicamente, deu certo) — sem isso só sabíamos o
// resultado final (linha em push_subscriptions ou não), impossível saber
// onde as pessoas desistiam de verdade. Fire-and-forget, nunca trava a UI.
function logPromptEvent(userId, event, detail) {
  if (!userId) return;
  supabase
    .from('push_prompt_events')
    .insert({ user_id: userId, event, detail: detail || null, user_agent: navigator.userAgent })
    .then(() => {})
    .catch(() => {});
}

export default function PushPermissionPrompt() {
  const [userId, setUserId] = useState(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorFlash, setErrorFlash] = useState(false);
  const shownLoggedRef = useRef(false);

  const canShowBanner = () => {
    if (!isPushSupported()) return false;
    if (getNotificationPermission() !== 'default') return false;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < COOLDOWN_MS) return false;
    return true;
  };

  useEffect(() => {
    if (!canShowBanner()) return;

    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user?.id) {
        setUserId(session.user.id);
        setVisible(true);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!canShowBanner()) return;
      if (session?.user?.id) {
        setUserId(session.user.id);
        setVisible(true);
      } else {
        setVisible(false);
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ loga "shown" só uma vez por vez que o banner efetivamente aparece.
  useEffect(() => {
    if (visible && userId && !shownLoggedRef.current) {
      shownLoggedRef.current = true;
      logPromptEvent(userId, 'shown');
    }
    if (!visible) shownLoggedRef.current = false;
  }, [visible, userId]);

  // ✅ 25/07: quando a permissão do navegador JÁ está concedida (ex: app
  // reinstalado, mas o Android guarda a permissão fora do storage do app),
  // a telinha de pedido nunca aparece de novo — sem isso a assinatura antiga
  // morre junto com a reinstalação e ninguém percebe que parou de chegar
  // notificação. Renova em silêncio, sem UI, sempre que houver sessão.
  useEffect(() => {
    if (!isPushSupported()) return;
    if (getNotificationPermission() !== 'granted') return;

    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) ensureSubscriptionSynced(session?.user?.id);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      ensureSubscriptionSynced(session?.user?.id);
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const dismiss = () => {
    logPromptEvent(userId, 'dismissed');
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const handleAccept = async () => {
    setLoading(true);
    logPromptEvent(userId, 'accepted');
    const result = await subscribeToPush(userId);
    setLoading(false);

    if (!result.ok) {
      // ✅ 10/08: "recusou de propósito" (negou no navegador) e "quis, mas
      // deu erro técnico" são coisas diferentes — só o primeiro conta como
      // recusa de verdade. Erro técnico não aplica o cooldown: quem já
      // disse sim não deve ser punido por uma falha nossa. Se o motivo foi
      // a permissão negada no próprio navegador, isso já fica bloqueado
      // pra sempre pelo navegador (Notification.permission vira "denied"),
      // não precisa de nada nosso pra reforçar isso. Se foi outro erro
      // (rede, salvar no banco), a sincronização silenciosa acima já fica
      // tentando de novo sozinha nas próximas visitas, sem incomodar com
      // o banner de novo.
      logPromptEvent(userId, result.reason === 'denied' ? 'permission_denied' : 'subscribe_failed', result.detail || result.reason);
      console.error('[push] assinatura não concluída:', result.reason, result.detail);
      setErrorFlash(true);
      setTimeout(() => setErrorFlash(false), 4000);
      setVisible(false);
      return;
    }

    logPromptEvent(userId, 'subscribe_success');
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  if (!visible && !errorFlash) return null;

  if (errorFlash) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-[60] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4">
        <p className="text-slate-300 text-xs">
          Ops, não deu pra ativar agora 😅 A gente tenta de novo automaticamente mais tarde.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-[60] bg-slate-900 border border-purple-500/60 rounded-2xl shadow-2xl shadow-purple-900/40 p-4 flex gap-3 items-start">
      <div className="bg-purple-600/20 rounded-full p-2 shrink-0">
        <Bell className="w-5 h-5 text-purple-400" />
      </div>
      <div className="flex-1">
        <p className="text-slate-100 text-sm font-semibold">Não perca nada! 🔔</p>
        <p className="text-slate-400 text-xs mt-1">
          Ative os avisos: te chamamos quando sai dorama novo e antes do seu acesso vencer, sem precisar ficar checando o site.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={handleAccept}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-md disabled:opacity-60"
          >
            {loading ? 'Ativando...' : 'Quero receber'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="text-slate-400 hover:text-slate-200 text-xs font-medium px-3 py-1.5"
          >
            Agora não
          </button>
        </div>
      </div>
      <button type="button" onClick={dismiss} className="text-slate-500 hover:text-slate-300 shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
