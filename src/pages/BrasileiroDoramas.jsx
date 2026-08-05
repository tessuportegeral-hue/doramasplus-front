import React from 'react';
import { Flag } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_brasileiro', true);

export default function BrasileiroDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Brasileiros"
      title="Brasileiros"
      subtitle="Produções nacionais no estilo dorama."
      icon={<Flag className="w-8 h-8 text-emerald-500" />}
      spinnerClass="border-emerald-500"
      emptyMessage="Nenhum dorama encontrado nessa categoria."
      applyFilter={applyFilter}
    />
  );
}
