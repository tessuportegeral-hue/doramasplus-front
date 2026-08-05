import React from 'react';
import { Globe } from 'lucide-react';
import CategoryDoramaGrid from '@/components/CategoryDoramaGrid';

// alt_bunny_url preenchido = tem áudio alternativo cadastrado, que pela
// convenção do admin é sempre o oposto de `language` — então mesmo um
// dorama com language='legendado' entra aqui se tiver dublado como alt.
const applyFilter = (q) => q.or('language.eq.dublado,alt_bunny_url.not.is.null');

export default function DubbedDoramas() {
  return (
    <CategoryDoramaGrid
      pageTitle="Doramas Dublados"
      title="Doramas Dublados"
      subtitle="Assista às suas histórias favoritas com áudio em português."
      icon={<Globe className="w-8 h-8 text-blue-500" />}
      spinnerClass="border-blue-500"
      emptyMessage="Nenhum dorama dublado encontrado."
      applyFilter={applyFilter}
    />
  );
}
