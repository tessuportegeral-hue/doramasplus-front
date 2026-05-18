import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CreditCard,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Gift,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';

const PLANS_URL = '/plans';

const MinhaConta = () => {
  const { user } = useAuth();
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

  const planName =
    subscription?.plan_name || subscription?.price_nickname || null;

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
  const noSubscription = !loading && !subscription;
  const showRenew = noSubscription || expired || !isActive;

  return (
    <>
      <Helmet>
        <title>Minha Conta | DoramasPlus</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-50">
        <Navbar />

        <main className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="max-w-2xl mx-auto"
          >
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">Minha Conta</h1>
            <p className="text-sm text-slate-400 mb-6">
              Veja os detalhes da sua assinatura.
            </p>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <CreditCard className="w-5 h-5 text-purple-300" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Minha Assinatura</h2>
                  <p className="text-xs text-slate-400">
                    {user?.email || ''}
                  </p>
                </div>
              </div>

              {loading ? (
                <p className="text-sm text-slate-400">Carregando...</p>
              ) : noSubscription ? (
                <div className="text-sm text-slate-300">
                  <p className="mb-4">
                    Você ainda não possui uma assinatura ativa.
                  </p>
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
                          Renovar assinatura{' '}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Link
              to="/indicar"
              className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 p-4 transition"
            >
              <div className="flex items-center gap-3">
                <Gift className="w-5 h-5 text-emerald-300" />
                <div>
                  <p className="text-sm font-semibold">Indique e ganhe dias grátis</p>
                  <p className="text-xs text-slate-400">
                    Compartilhe seu link e estenda sua assinatura.
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-emerald-300" />
            </Link>
          </motion.div>
        </main>
      </div>
    </>
  );
};

export default MinhaConta;
