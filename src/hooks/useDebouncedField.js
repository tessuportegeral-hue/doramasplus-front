import { startTransition, useEffect, useRef, useState } from "react";

// ✅ 13/08 (INP) — a telemetria CWV pegou o campo de busca com INP p75 de
// 1,3s no mobile (665ms só de inputDelay): cada tecla setava searchQuery lá
// no App e re-renderizava o Dashboard INTEIRO (10+ seções) por caractere.
// Este hook mantém o valor digitado em estado LOCAL (só o input re-renderiza
// a cada tecla) e propaga pro estado global depois de uma pausa curta.
// Ver [[project-web-vitals-rum-instrumentation]].
export default function useDebouncedField(value, onCommit, delay = 250) {
  const [local, setLocal] = useState(value ?? "");
  const timer = useRef(null);
  const lastCommitted = useRef(value ?? "");

  // Mudança vinda de fora (ex.: botão "Limpar" zera o estado global):
  // sincroniza o campo. Comparar com o último commit evita que o eco do
  // próprio commit atropele o que o usuário ainda está digitando.
  useEffect(() => {
    if ((value ?? "") !== lastCommitted.current) {
      lastCommitted.current = value ?? "";
      setLocal(value ?? "");
    }
  }, [value]);

  const set = (next) => {
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lastCommitted.current = next;
      // ✅ 13/08 (2ª dose) — o debounce sozinho não bastou: quando o commit
      // dispara, o re-render do Dashboard (Fuse + trocar seções por
      // resultados) bloqueia ~1s em celular lento, e a PRÓXIMA tecla chega
      // no meio dele (telemetria: inputDelay 888ms com processing só 79ms).
      // startTransition torna esse render interrompível: tecla nova tem
      // prioridade e corta o render no meio, sem travar a digitação.
      startTransition(() => onCommit(next));
    }, delay);
  };

  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  return [local, set];
}
