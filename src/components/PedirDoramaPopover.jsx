import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Clapperboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/supabaseClient';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const PedirDoramaPopover = () => {
  const { user } = useAuth();
  const [titulo, setTitulo] = useState('');
  const [sending, setSending] = useState(false);
  const [jaTem, setJaTem] = useState(null);
  const [avisoLimite, setAvisoLimite] = useState('');

  if (!user) return null;

  const resetFeedback = () => {
    setJaTem(null);
    setAvisoLimite('');
  };

  // ✅ 05/08: o "já temos X" é uma SUGESTÃO, não pode travar o pedido — antes,
  // quando o fuzzy match achava algo parecido (sim > 0.4, que é bem permissivo),
  // o pedido simplesmente não ia pra frente e não tinha como continuar mesmo
  // sendo outro título. Agora, se não for forçado, mostra a sugestão mas
  // mantém o texto digitado; a pessoa decide se quer pedir mesmo assim.
  const handlePedir = async (forcar = false) => {
    const nome = titulo.trim();
    if (!nome) return;
    try {
      setSending(true);

      if (!forcar) {
        setAvisoLimite('');
        const { data: encontrados } = await supabase.rpc('search_doramas_fuzzy', { query: nome });
        const achado = (encontrados || []).find((d) => d.sim > 0.4);
        if (achado) {
          setJaTem(achado);
          toast({
            title: 'Esse a gente já tem! 🎉',
            description: `"${achado.title}" já está no catálogo. Se não for o que você procura, pode pedir mesmo assim.`,
          });
          return;
        }
      }
      resetFeedback();

      const { error } = await supabase
        .from('dorama_requests')
        .insert({ user_id: user.id, dorama_name: nome, source: 'site' });
      if (error) throw error;

      setTitulo('');
      toast({
        title: 'Pedido registrado! 🎬',
        description: 'Assim que adicionarmos, avisamos você por aqui.',
      });
    } catch (err) {
      const limite = String(err?.message || '').includes('dorama_request_limit_reached');
      if (limite) {
        setAvisoLimite('Você atingiu o limite de pedidos por enquanto. Veja em Configurações quando libera de novo.');
      }
      toast({
        title: limite ? 'Limite de pedidos atingido' : 'Não foi possível registrar seu pedido',
        description: limite ? 'Aguarde pra pedir mais.' : 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          setTitulo('');
          resetFeedback();
        }
      }}
    >
      <div className="relative inline-block">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-0.5 rounded-full bg-purple-500 opacity-60 blur-md animate-pulse"
        />
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            title="Pedir um dorama"
            className="relative text-purple-300 hover:text-white hover:bg-transparent border border-purple-500/70 hover:border-purple-400 rounded-full w-9 h-9 p-0 flex items-center justify-center transition"
          >
            <Send className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="bg-slate-900 border-slate-800 text-slate-200 w-80 p-4"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Clapperboard className="w-4 h-4 text-purple-300" />
          <p className="text-sm font-semibold text-white">Pedir um Dorama</p>
        </div>

        {jaTem && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2.5 mb-2">
            <Link
              to={`/dorama/${jaTem.slug}`}
              className="flex items-center justify-between hover:opacity-80 transition"
            >
              <span className="text-xs text-emerald-200">
                🎉 Já temos <span className="font-semibold">{jaTem.title}</span>!
              </span>
              <span className="text-xs text-emerald-300 font-semibold flex-shrink-0 ml-2">Assistir →</span>
            </Link>
            <button
              type="button"
              onClick={() => handlePedir(true)}
              disabled={sending}
              className="mt-1.5 text-[11px] text-slate-400 hover:text-slate-200 underline disabled:opacity-50"
            >
              Não é esse, pedir mesmo assim
            </button>
          </div>
        )}

        {avisoLimite ? (
          <p className="text-xs text-amber-300">{avisoLimite}</p>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={titulo}
              onChange={(e) => {
                setTitulo(e.target.value);
                if (jaTem) setJaTem(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handlePedir()}
              placeholder="Nome do dorama"
              className="flex-1 rounded-lg bg-white/5 border border-slate-700 px-3 py-2 text-sm text-white outline-none focus:border-purple-500/60"
            />
            <Button
              type="button"
              onClick={() => handlePedir()}
              disabled={!titulo.trim() || sending}
              className="bg-purple-600 hover:bg-purple-700 px-3"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        )}

        <Link
          to="/minha-conta"
          className="block text-center text-xs text-slate-500 hover:text-slate-300 mt-3 transition"
        >
          Ver todos os seus pedidos →
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PedirDoramaPopover;
