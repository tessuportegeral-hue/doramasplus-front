import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { isPushSupported, getNotificationPermission, subscribeToPush } from '@/lib/pushNotifications';

const DISMISS_KEY = 'dp_push_prompt_dismissed';

// ✅ 25/07: pedido "soft-ask" antes da permissão nativa do navegador —
// se a gente disparar Notification.requestPermission() do nada, boa parte
// clica "Bloquear" no automático e depois é difícil reverter. Mostrando
// esse aviso nosso antes, só chamamos a permissão real se a pessoa topar.
export default function PushPermissionPrompt() {
  const [userId, setUserId] = useState(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    if (getNotificationPermission() !== 'default') return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user?.id) {
        setUserId(session.user.id);
        setVisible(true);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (getNotificationPermission() !== 'default' || localStorage.getItem(DISMISS_KEY)) return;
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
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const handleAccept = async () => {
    setLoading(true);
    const result = await subscribeToPush(userId);
    setLoading(false);
    if (!result.ok) {
      // ⚠️ 25/07: alert temporário pra diagnosticar o rollout inicial —
      // sem isso não tem como saber o motivo da falha em quem testa pelo
      // celular (sem acesso a devtools). Remover depois que confirmar.
      console.error('[push] assinatura não concluída:', result.reason, result.detail);
      window.alert(`Não deu pra ativar as notificações 😕\n\nMotivo: ${result.reason}\n${result.detail || ''}`);
      return;
    }
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-[60] bg-slate-900 border border-purple-500/40 rounded-2xl shadow-2xl p-4 flex gap-3 items-start">
      <div className="bg-purple-600/20 rounded-full p-2 shrink-0">
        <Bell className="w-5 h-5 text-purple-400" />
      </div>
      <div className="flex-1">
        <p className="text-slate-100 text-sm font-semibold">Quer receber avisos? 🔔</p>
        <p className="text-slate-400 text-xs mt-1">
          Te avisamos quando seu acesso tá vencendo e quando sai dorama novo no catálogo.
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
