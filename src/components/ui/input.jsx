import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef(
  ({ className, type = "text", inputMode, pattern, ...props }, ref) => {
    // ✅ Correção mobile:
    // - Evita teclado numérico em campos de texto/email quando algum pattern="\d*" estiver vindo de outro lugar
    // - Define inputMode padrão coerente por type
    let resolvedInputMode = inputMode;
    let resolvedPattern = pattern;

    const t = String(type || "text").toLowerCase();

    if (!resolvedInputMode) {
      if (t === "email") resolvedInputMode = "email";
      else if (t === "tel" || t === "number") resolvedInputMode = "numeric";
      else resolvedInputMode = "text"; // text/password/etc
    }

    // Se for text/email/password, NÃO deixa pattern numérico forçar teclado numérico
    if (t === "text" || t === "email" || t === "password") {
      if (resolvedPattern && String(resolvedPattern).includes("\\d")) {
        resolvedPattern = undefined;
      }
      // Também remove o caso comum pattern="\d*"
      if (resolvedPattern && String(resolvedPattern).includes("d*")) {
        resolvedPattern = undefined;
      }
    }

    return (
      <input
        type={type}
        inputMode={resolvedInputMode}
        pattern={resolvedPattern}
        className={cn(
          "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:placeholder:text-slate-400 dark:focus-visible:ring-slate-300",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input };
