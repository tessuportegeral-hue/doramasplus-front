import React from 'react';
import { Eye } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_hidden_identity', true);

export default function HiddenIdentityDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Identidade Escondida"
      title="Identidade Escondida"
      subtitle="Personagens que escondem quem realmente são."
      icon={<Eye className="w-8 h-8 text-teal-500" />}
      spinnerClass="border-teal-500"
      emptyMessage="Nenhum dorama encontrado nessa categoria."
      applyFilter={applyFilter}
    />
  );
}
