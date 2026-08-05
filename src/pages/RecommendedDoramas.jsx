import React from 'react';
import { Star } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

// ✅ 05/08 fix: essa página se chama "Recomendados" e é pra onde o menu
// "Recomendados Para Você" leva, mas filtrava is_featured (o campo que
// alimenta o carrossel/banner do topo do dashboard, sem nome próprio pro
// usuário) em vez de is_recommended (a fileira "Recomendados Para Você" de
// verdade). Corrigido pra bater com o nome e com o que o dashboard mostra.
const applyFilter = (q) => q.eq('is_recommended', true);

export default function RecommendedDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Recomendados Para Você"
      title="Recomendados"
      subtitle="Nossa curadoria especial com os melhores doramas para você."
      icon={<Star className="w-8 h-8 text-amber-500 fill-amber-500" />}
      spinnerClass="border-amber-500"
      emptyMessage="Nenhum dorama recomendado encontrado."
      applyFilter={applyFilter}
    />
  );
}
