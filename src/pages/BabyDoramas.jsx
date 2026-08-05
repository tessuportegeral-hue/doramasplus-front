import React from 'react';
import { Baby } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

const applyFilter = (q) => q.eq('is_baby_pregnancy', true);

export default function BabyDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Bebês e Gravidezes"
      title="Bebês e Gravidezes"
      subtitle="Histórias de família, gravidez e a chegada de um bebê."
      icon={<Baby className="w-8 h-8 text-pink-500" />}
      spinnerClass="border-pink-500"
      emptyMessage="Nenhum dorama encontrado nessa categoria."
      applyFilter={applyFilter}
    />
  );
}
