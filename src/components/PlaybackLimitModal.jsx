export default function PlaybackLimitModal({ info, onTakeOver, onUpgrade, onCancel }) {
  const isPremium = info?.plan_type === "premium";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-6 text-white shadow-2xl">
        <h2 className="mb-3 text-xl font-bold">Limite de telas atingido</h2>
        <p className="mb-6 text-zinc-300">
          {info?.message ||
            (isPremium
              ? `Seu plano permite ${info?.max_streams} telas simultâneas e todas estão em uso.`
              : "Outro dispositivo está assistindo agora. Seu plano permite 1 tela por vez.")}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onTakeOver}
            className="rounded-lg bg-purple-600 py-3 font-semibold hover:bg-purple-700"
          >
            Assumir aqui
          </button>
          {!isPremium && (
            <button
              onClick={onUpgrade}
              className="rounded-lg border border-purple-500 py-3 font-semibold text-purple-300 hover:bg-purple-500/10"
            >
              Conhecer plano Premium (3 telas)
            </button>
          )}
          <button
            onClick={onCancel}
            className="rounded-lg py-3 text-zinc-400 hover:text-white"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
