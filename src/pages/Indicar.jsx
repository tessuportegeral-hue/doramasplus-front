import React, { useEffect, useState, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Copy, Check, Gift, Users, Calendar } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';

const Indicar = () => {
  const { user } = useAuth();
  const [refCode, setRefCode] = useState('');
  const [creditedCount, setCreditedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const inviteLink = useMemo(
    () => (refCode ? `https://doramasplus.com.br/cadastro?ref=${refCode}` : ''),
    [refCode]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }
      try {
        const [{ data: profile }, { count }] = await Promise.all([
          supabase
            .from('profiles')
            .select('ref_code')
            .eq('id', user.id)
            .maybeSingle(),
          supabase
            .from('referrals')
            .select('id', { count: 'exact', head: true })
            .eq('referrer_id', user.id)
            .eq('status', 'credited'),
        ]);

        if (cancelled) return;
        setRefCode(profile?.ref_code || '');
        setCreditedCount(count || 0);
      } catch (e) {
        console.error('[Indicar] erro ao carregar dados:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({ title: 'Link copiado!', description: 'Cole onde quiser compartilhar.' });
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast({
        title: 'Não foi possível copiar',
        description: 'Selecione o link manualmente.',
        variant: 'destructive',
      });
    }
  };

  const daysEarned = creditedCount * 15;

  return (
    <>
      <Helmet>
        <title>Indique e Ganhe - DoramasPlus</title>
        <meta
          name="description"
          content="Indique amigos e ganhe 15 dias grátis no DoramasPlus para cada indicação."
        />
      </Helmet>

      <div className="min-h-screen bg-slate-950">
        <Navbar isAuthenticated={true} />

        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="text-center mb-10">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-600/20 mb-4">
                <Gift className="w-8 h-8 text-purple-400" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                Indique e ganhe 15 dias grátis
              </h1>
              <p className="text-slate-400">
                Compartilhe seu link. A cada amigo que assinar o DoramasPlus pelo Pix,
                você ganha <strong className="text-white">15 dias</strong> adicionados na sua conta.
              </p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-6">
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Seu link único
              </label>
              {loading ? (
                <div className="h-12 rounded-lg bg-slate-800 animate-pulse" />
              ) : !inviteLink ? (
                <p className="text-slate-500 text-sm">
                  Não foi possível carregar seu código. Recarregue a página.
                </p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    readOnly
                    value={inviteLink}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <Button
                    onClick={handleCopy}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-6"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copiar
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  <span className="text-sm text-slate-400">Indicações válidas</span>
                </div>
                <p className="text-3xl font-bold text-white">
                  {loading ? '—' : creditedCount}
                </p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-2">
                  <Calendar className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-slate-400">Dias ganhos</span>
                </div>
                <p className="text-3xl font-bold text-white">
                  {loading ? '—' : daysEarned}
                </p>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-sm text-slate-400 space-y-2">
              <p className="text-white font-semibold mb-2">Como funciona</p>
              <p>1. Compartilhe seu link com amigos.</p>
              <p>2. Quando o amigo se cadastrar pelo seu link e fizer o primeiro pagamento via Pix, você ganha 15 dias grátis.</p>
              <p>3. Os dias são somados automaticamente ao final da sua assinatura atual.</p>
              <p className="text-xs text-slate-500 pt-2">
                * O crédito vale apenas para contas novas. Auto-indicação não é permitida.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default Indicar;
