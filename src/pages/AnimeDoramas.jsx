import React from 'react';
import { Tv } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_anime', true);

export default function AnimeDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Animes"
      title="Animes"
      subtitle="Animações no estilo asiático."
      icon={<Tv className="w-8 h-8 text-cyan-500" />}
      spinnerClass="border-cyan-500"
      emptyMessage="Nenhum dorama encontrado nessa categoria."
      applyFilter={applyFilter}
    />
  );
}
