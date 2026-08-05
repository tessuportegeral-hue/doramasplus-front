import React from 'react';
import { Moon } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_lobos_vampiros', true);

export default function WolfVampireDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Lobos & Vampiros"
      title="Lobos & Vampiros"
      subtitle="Fantasia sobrenatural: lobisomens, vampiros e criaturas da noite."
      icon={<Moon className="w-8 h-8 text-indigo-500" />}
      spinnerClass="border-indigo-500"
      emptyMessage="Nenhum dorama encontrado nessa categoria."
      applyFilter={applyFilter}
    />
  );
}
