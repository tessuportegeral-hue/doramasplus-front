import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Check, Loader2, Star, MessageCircle } from 'lucide-react';

import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';

const SubscriptionPlans = () => {
  const { toast } = useToast();
  const [loadingPlan, setLoadingPlan] = useState(null);

  // ✅ (NOVO) META PIXEL - InitiateCheckout (mínimo e seguro)
  // - Gera event_id para deduplicação futura (Purchase via CAPI no webhook)
  // - Salva no localStorage apenas para debug/uso futuro
  const fireInitiateCheckout = ({ planType, planName, value }) => {
    try {
      const eventId = `ic_${planType}_${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}`;

      // ✅ guarda o último event id (útil pra debug)
      try {
        localStorage.setItem('dp_last_initiatecheckout_event_id', eventId);
      } catch {}

      // ✅ guarda dados do plano para a página /obrigado disparar Purchase depois
      try {
        localStorage.setItem(
          'dp_last_checkout',
          JSON.stringify({
            planType,
            planName,
            value: Number(value),
            currency: 'BRL',
            ts: Date.now(),
            eventId,
          })
        );
      } catch {}

      if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
        window.fbq(
          'track',
          'InitiateCheckout',
          {
            value: Number(value),
            currency: 'BRL',
            content_name: planName,
          },
          { eventID: eventId }
        );
      }

      return eventId;
    } catch {
      return null;
    }
  };

  // ✅ STRIPE (mantém do jeito que já está)
  const handleSubscribe = async (planType) => {
    if (loadingPlan) return;

    if (!['monthly', 'quarterly'].includes(planType)) {
      toast({
        variant: 'destructive',
        title: 'Plano inválido',
        description: 'Escolha um plano válido para assinar.',
      });
      return;
    }

    setLoadingPlan(planType);

    try {
      // ✅ (NOVO) dispara InitiateCheckout no clique do Cartão também
      const planName =
        planType === 'quarterly' ? 'DoramasPlus Trimestral' : 'DoramasPlus Padrão';
      const value = planType === 'quarterly' ? 43.9 : 15.9;

      fireInitiateCheckout({
        planType,
        planName,
        value,
      });

      // 1) sessão ao vivo
      const { data: s, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;

      const token = s?.session?.access_token;
      if (!token) {
        toast({
          variant: 'destructive',
          title: 'Autenticação necessária',
          description: 'Faça login novamente para assinar.',
        });
        return;
      }

      // 2) chama a Edge Function (Stripe)
      const { data, error } = await supabase.functions.invoke(
        'create-checkout-session',
        {
          body: { plan: planType },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (error) {
        console.error('Supabase function error:', error);
        throw new Error(error.message || 'Erro ao comunicar com o servidor');
      }

      if (!data?.url) {
        throw new Error('URL de checkout não retornada');
      }

      window.location.href = data.url;
    } catch (err) {
      console.error('ASSINATURA ERRO FINAL:', err);
      toast({
        variant: 'destructive',
        title: 'Erro na assinatura',
        description: err?.message || 'Erro ao iniciar assinatura, tente novamente.',
      });
    } finally {
      setLoadingPlan(null);
    }
  };

  // ✅ INFINITEPAY PIX (novo, sem quebrar Stripe)
  const handlePix = async (planType) => {
    if (loadingPlan) return;

    if (!['monthly', 'quarterly'].includes(planType)) {
      toast({
        variant: 'destructive',
        title: 'Plano inválido',
        description: 'Escolha um plano válido para pagar no Pix.',
      });
      return;
    }

    setLoadingPlan(`pix_${planType}`);

    try {
      const { data: s, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;

      const token = s?.session?.access_token;
      if (!token) {
        toast({
          variant: 'destructive',
          title: 'Autenticação necessária',
          description: 'Faça login novamente para pagar no Pix.',
        });
        return;
      }

      // ✅ (NOVO) dispara InitiateCheckout no clique do Pix
      const planName =
        planType === 'quarterly' ? 'DoramasPlus Trimestral' : 'DoramasPlus Padrão';
      const value = planType === 'quarterly' ? 43.9 : 15.9;

      const event_id = fireInitiateCheckout({
        planType,
        planName,
        value,
      });

      const { data, error } = await supabase.functions.invoke(
        'infinitepay-create-checkout',
        {
          // ✅ (NOVO) envia event_id para o backend salvar no pix_payments
          body: { plan: planType, event_id },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (error) {
        console.error('InfinitePay function error:', error);
        throw new Error(error.message || 'Erro ao comunicar com o servidor');
      }

      if (!data?.url) {
        throw new Error('URL do Pix não retornada');
      }

      window.location.href = data.url;
    } catch (err) {
      console.error('PIX ERRO FINAL:', err);
      toast({
        variant: 'destructive',
        title: 'Erro no Pix',
        description: err?.message || 'Erro ao iniciar pagamento Pix, tente novamente.',
      });
    } finally {
      setLoadingPlan(null);
    }
  };

  // ✅ Loading
  const isLoading = !!loadingPlan;

  // ✅ WHATSAPP (SUPORTE) — ADIÇÃO
  const whatsappLink =
    'https://wa.me/5518996796654?text=' +
    encodeURIComponent('Ola estou com uma Duvida. Você pode me Ajudar?');

  return (
    <>
      <Helmet>
        <title>Planos de Assinatura - DoramasPlus</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <Navbar />

        <div className="pt-24 pb-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center mb-12">
            <motion.h1
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl font-bold text-white mb-4"
            >
              Escolha seu Plano
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-slate-400 text-lg"
            >
              Acesso ilimitado a milhares de doramas, sem anúncios.
            </motion.p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* ✅ PLANO MENSAL */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col hover:border-purple-500/50 transition-colors"
            >
              <h3 className="text-2xl font-bold text-white mb-2">
                DoramasPlus Padrão
              </h3>

              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold text-purple-400">
                  R$ 15,90
                </span>
                <span className="text-slate-400">/mês</span>
              </div>

              <ul className="space-y-4 mb-8 flex-1">
                {[
                  'Acesso ilimitado',
                  'Sem anúncios',
                  'Qualidade HD',
                  'Assista em qualquer lugar',
                  'Sem travamentos',
                  'Atualizações todos os dias',
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-300">
                    <div className="bg-purple-500/20 rounded-full p-1">
                      <Check className="w-4 h-4 text-purple-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>

              {/* STRIPE */}
              <Button
                onClick={() => handleSubscribe('monthly')}
                disabled={isLoading}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white py-6 text-lg font-medium"
              >
                {loadingPlan === 'monthly' ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Assinar no Cartão – R$ 15,90'
                )}
              </Button>

              {/* PIX INFINITEPAY */}
              <Button
                onClick={() => handlePix('monthly')}
                disabled={isLoading}
                className="w-full mt-3 bg-emerald-600 hover:bg-emerald-700 text-white py-6 text-lg font-medium"
              >
                {loadingPlan === 'pix_monthly' ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Pagar no Pix – R$ 15,90'
                )}
              </Button>
            </motion.div>

            {/* ✅ PLANO TRIMESTRAL */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="relative bg-gradient-to-b from-purple-900/20 to-slate-900 border border-purple-500/30 rounded-2xl p-8 flex flex-col"
            >
              <div className="absolute top-4 right-4 bg-purple-600 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                <Star className="w-3 h-3" fill="currentColor" />
                MELHOR VALOR
              </div>

              <h3 className="text-2xl font-bold text-white mb-2">
                DoramasPlus Trimestral
              </h3>

              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-4xl font-bold text-purple-400">
                  R$ 43,90
                </span>
                <span className="text-slate-400">/3 meses</span>
              </div>

              <ul className="space-y-4 mb-8 flex-1">
                {[
                  'Tudo do plano Padrão',
                  'Prioridade no suporte',
                  'Downloads offline (em breve)',
                  'Economia garantida',
                  'Sem travamentos',
                  'Atualizações todos os dias',
                  'Aba exclusiva de Continuar Assistindo',
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-300">
                    <div className="bg-purple-500/20 rounded-full p-1">
                      <Check className="w-4 h-4 text-purple-400" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>

              {/* STRIPE */}
              <Button
                onClick={() => handleSubscribe('quarterly')}
                disabled={isLoading}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white py-6 text-lg font-medium"
              >
                {loadingPlan === 'quarterly' ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Assinar no Cartão – R$ 43,90'
                )}
              </Button>

              {/* PIX INFINITEPAY */}
              <Button
                onClick={() => handlePix('quarterly')}
                disabled={isLoading}
                className="w-full mt-3 bg-emerald-600 hover:bg-emerald-700 text-white py-6 text-lg font-medium"
              >
                {loadingPlan === 'pix_quarterly' ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Pagar no Pix – R$ 43,90'
                )}
              </Button>
            </motion.div>
          </div>

          {/* ✅ BLOCO PIX (mantém visual, agora 100% automático) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-12 max-w-3xl mx-auto bg-gradient-to-b from-emerald-600/20 to-slate-900 border border-emerald-500/70 rounded-2xl px-6 py-8 text-center"
          >
            <p className="text-xs font-bold tracking-widest text-emerald-300 mb-2 uppercase">
              Pagamento via Pix disponível
            </p>

            <h3 className="text-2xl sm:text-3xl font-bold text-emerald-100 mb-3">
              💸 Pague via Pix (automático)
            </h3>

            <p className="text-sm sm:text-base text-emerald-50 mb-6">
              Clique em um dos botões de Pix acima. Assim que o pagamento for confirmado, sua assinatura é liberada automaticamente.
            </p>
          </motion.div>

          {/* ✅ WHATSAPP – DÚVIDAS / SUPORTE (ADIÇÃO) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="mt-6 max-w-3xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl px-6 py-6 text-center"
          >
            <p className="text-sm text-slate-300 mb-4">
              Dúvidas? Chame no WhatsApp:
            </p>

            <Button asChild className="bg-green-600 hover:bg-green-700">
              <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="w-5 h-5 mr-2" />
                Chamar no WhatsApp
              </a>
            </Button>
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default SubscriptionPlans;