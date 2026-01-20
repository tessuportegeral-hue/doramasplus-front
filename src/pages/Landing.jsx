import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { motion } from 'framer-motion';
import { Play, TrendingUp, Users, Star, AlertCircle, Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import DoramaCard from '@/components/DoramaCard';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient'; 
import { useAuth } from '@/contexts/SupabaseAuthContext';

const Landing = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [featuredDoramas, setFeaturedDoramas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/dashboard');
      return;
    }

    const loadFeatured = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
            .from('doramas')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(6);
            
        if (error) throw error;
        setFeaturedDoramas(data || []);
      } catch (error) {
        console.error('Error loading featured doramas:', error);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    if (!isAuthenticated) {
        loadFeatured();
    }
  }, [navigate, isAuthenticated, authLoading]);

  if (authLoading || (!isAuthenticated && loading)) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-12 h-12 animate-spin text-purple-500" />
      </div>
    );
  }

  // If authenticated, the redirect in useEffect will handle it. Render nothing here.
  if (isAuthenticated) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>DoramaStream - Assista seus Dramas Asiáticos Favoritos</title>
        <meta name="description" content="Assista aos melhores doramas coreanos e asiáticos online. Descubra novos shows, assista seus favoritos e nunca perca um episódio." />
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <Navbar />

        {/* Hero Section */}
        <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 via-slate-950 to-slate-950 pointer-events-none" />
          
          <div className="container mx-auto relative z-10">
            <div className="max-w-4xl mx-auto text-center">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
              >
                <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
                  Assista aos Seus
                  <span className="block text-purple-500 mt-2">Doramas Favoritos</span>
                </h1>
                
                <p className="text-lg sm:text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                  Streaming ilimitado de dramas coreanos e asiáticos. Novos episódios adicionados semanalmente. Assista onde e quando quiser.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Link to="/signup">
                    <Button size="lg" className="bg-purple-600 hover:bg-purple-700 text-lg px-8 py-6 rounded-full font-semibold shadow-lg hover:shadow-purple-500/25 transition-all">
                      <Play className="w-5 h-5 mr-2 fill-white" />
                      Começar a Assistir Grátis
                    </Button>
                  </Link>
                  <Link to="/login">
                    <Button size="lg" variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 text-lg px-8 py-6 rounded-full">
                      Entrar
                    </Button>
                  </Link>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-12 px-4 sm:px-6 lg:px-8 bg-slate-900/50 border-y border-slate-800/50">
          <div className="container mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
              <StatsCard icon={<TrendingUp />} value="500+" label="Doramas Disponíveis" delay={0.1} />
              <StatsCard icon={<Users />} value="10k+" label="Fãs Ativos" delay={0.2} />
              <StatsCard icon={<Star className="fill-current" />} value="4.8/5" label="Avaliação Média" delay={0.3} />
            </div>
          </div>
        </section>

        {/* Featured Doramas */}
        <section className="py-20 px-4 sm:px-6 lg:px-8">
          <div className="container mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                Adicionados Recentemente
              </h2>
              <p className="text-slate-400 max-w-2xl mx-auto">
                Confira os últimos lançamentos que acabaram de chegar na plataforma
              </p>
            </motion.div>

            {loading ? (
              <div className="flex justify-center items-center py-20">
                <Loader2 className="w-12 h-12 animate-spin text-purple-500" />
              </div>
            ) : error ? (
              <div className="text-center py-12 bg-slate-900 rounded-xl border border-slate-800 max-w-lg mx-auto">
                <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
                <p className="text-red-400">Não foi possível carregar os destaques.</p>
              </div>
            ) : featuredDoramas.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
                {featuredDoramas.map((dorama, index) => (
                  <DoramaCard key={dorama.id} dorama={dorama} index={index} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500">
                Nenhum dorama encontrado no momento.
              </div>
            )}

            <div className="text-center mt-12">
              <Link to="/signup">
                <Button size="lg" variant="secondary" className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700">
                  Ver Catálogo Completo
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-slate-950 border-t border-slate-900">
          <div className="container mx-auto text-center">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                <Play className="w-4 h-4 text-white fill-white ml-0.5" />
              </div>
              <span className="text-xl font-bold text-white">DoramaStream</span>
            </div>
            <p className="text-slate-500 text-sm">
              © {new Date().getFullYear()} DoramaStream. Todos os direitos reservados.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
};

const StatsCard = ({ icon, value, label, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ delay }}
    className="text-center p-6 rounded-2xl bg-slate-900/50 border border-slate-800/50"
  >
    <div className="flex justify-center mb-4">
      <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
        {React.cloneElement(icon, { className: "w-6 h-6" })}
      </div>
    </div>
    <div className="text-3xl font-bold text-white mb-1">{value}</div>
    <div className="text-sm text-slate-400 uppercase tracking-wide">{label}</div>
  </motion.div>
);

export default Landing;