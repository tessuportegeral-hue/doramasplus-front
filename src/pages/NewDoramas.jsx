import React from 'react';
import { BadgeCheck } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_new', true);

export default function NewDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Novos Lançamentos"
      title="Novos Lançamentos"
      subtitle="Acabaram de chegar! Confira as últimas adições ao nosso catálogo."
      icon={<BadgeCheck className="w-8 h-8 text-green-500" />}
      spinnerClass="border-green-500"
      emptyMessage="Nenhum lançamento recente encontrado."
      applyFilter={applyFilter}
    />
  );
}
