import React from 'react';
import { Heart } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_bl_gl', true);

export default function BlGlDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="BL & GL"
      title="BL & GL"
      subtitle="Boys Love e Girls Love: romances entre personagens do mesmo sexo."
      icon={<Heart className="w-8 h-8 text-rose-500" />}
      spinnerClass="border-rose-500"
      emptyMessage="Nenhum dorama encontrado nessa categoria."
      applyFilter={applyFilter}
    />
  );
}
