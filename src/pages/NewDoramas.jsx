import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Helmet } from 'react-helmet';
import { Search, BadgeCheck, AlertCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import DoramaCard from '@/components/DoramaCard';

export default function NewDoramas() {
  const [doramas, setDoramas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchDoramas();
  }, []);

  const fetchDoramas = async () => {
    setLoading(true);
    setError(false);
    try {
      const { data, error } = await supabase
        .from('doramas')
        .select('*')
        .eq('is_new', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDoramas(data || []);
    } catch (err) {
      console.error('Error fetching new doramas:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const filteredDoramas = doramas.filter(d =>
    d.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.genres && d.genres.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <>
      <Helmet>
        <title>Novos Lançamentos - DoramaStream</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <Navbar />

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          {/* Header Section */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-white flex items-center gap-3">
                <BadgeCheck className="w-8 h-8 text-green-500" />
                Novos Lançamentos
              </h1>
              <p className="text-slate-400 mt-2">
                Acabaram de chegar! Confira as últimas adições ao nosso catálogo.
              </p>
            </div>

            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar lançamentos..."
                className="w-full bg-slate-900/50 border border-slate-800 rounded-full pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Horizontal Scroll Content */}
          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
            </div>
          ) : error ? (
            <div className="text-center py-12 bg-slate-900/50 rounded-xl border border-slate-800 max-w-lg mx-auto">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-white mb-1">Erro ao carregar</h3>
              <p className="text-red-400">Não foi possível carregar os novos doramas.</p>
              <button 
                onClick={fetchDoramas}
                className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-md text-sm transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          ) : filteredDoramas.length > 0 ? (
            <div className="relative">
              {/* Horizontal scrolling container */}
              <div className="flex overflow-x-auto pb-8 pt-2 gap-6 snap-x snap-mandatory scrollbar-hide">
                {filteredDoramas.map((dorama, index) => (
                  <div key={dorama.id} className="flex-none w-[220px] snap-start">
                    <DoramaCard dorama={dorama} index={index} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500 bg-slate-900/30 rounded-2xl border border-slate-800/50 border-dashed">
              <p className="text-lg">Nenhum lançamento recente encontrado.</p>
              {searchQuery && <p className="text-sm mt-2">Tente buscar com outros termos.</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}