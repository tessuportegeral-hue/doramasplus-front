import React from 'react';
import { HeartHandshake } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_taboo_relationship', true);

export default function TabooDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Relacionamento Tabu"
      title="Relacionamento Tabu"
      subtitle="Romances proibidos, diferenças de idade e status social."
      icon={<HeartHandshake className="w-8 h-8 text-red-500" />}
      spinnerClass="border-red-500"
      emptyMessage="Nenhum dorama encontrado nessa categoria."
      applyFilter={applyFilter}
    />
  );
}
