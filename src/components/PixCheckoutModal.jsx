import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, CheckCircle, Copy, Check } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';

// ✅ 28/07: modal de Pix (Asaas) — mostra QR/copia-e-cola sem sair do site,
// com polling pra saber quando o pagamento confirmou. Quem realmente libera
// o acesso e' o asaas-webhook (backend); esse polling e' so pra UI.
const POLL_INTERVAL_MS = 4000;

const PixCheckoutModal = ({ open, onClose, checkout, onConfirmed }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState(false);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || !checkout?.order_nsu || paid) return;

    const poll = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const { data, error } = await supabase.functions.invoke('asaas-check-payment', {
          body: { order_nsu: checkout.order_nsu },
          headers: { Authorization: `Bearer ${token}` },
        });

        if (error) return;
        if (data?.status === 'paid') {
          setPaid(true);
          stopPolling();
        }
      } catch {}
    };

    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => stopPolling();
  }, [open, checkout?.order_nsu, paid, stopPolling]);

  useEffect(() => {
    if (!open) {
      setPaid(false);
      setCopied(false);
      stopPolling();
    }
  }, [open, stopPolling]);

  const handleCopy = async () => {
    if (!checkout?.copy_paste) return;
    try {
      await navigator.clipboard.writeText(checkout.copy_paste);
      setCopied(true);
      toast({ title: 'Código copiado!' });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Não foi possível copiar',
        description: 'Selecione o código manualmente.',
      });
    }
  };

  const handleClose = () => {
    stopPolling();
    onClose?.();
  };

  const priceLabel = checkout?.amount_cents
    ? `R$ ${(checkout.amount_cents / 100).toFixed(2).replace('.', ',')}`
    : '';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="bg-slate-900 border border-slate-800 text-white max-w-sm">
        {paid ? (
          <div className="flex flex-col items-center text-center py-6">
            <div className="bg-green-500/20 p-4 rounded-full mb-4">
              <CheckCircle className="w-14 h-14 text-green-500" />
            </div>
            <h2 className="text-xl font-bold mb-2">Pagamento confirmado!</h2>
            <p className="text-slate-400 mb-6">Sua assinatura já foi liberada.</p>
            <Button
              className="w-full bg-purple-600 hover:bg-purple-700"
              onClick={() => {
                handleClose();
                onConfirmed?.();
              }}
            >
              Continuar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <h2 className="text-xl font-bold mb-1">Pague com Pix</h2>
            {priceLabel ? (
              <p className="text-slate-400 mb-4">{priceLabel}</p>
            ) : null}

            {checkout?.qr_code_base64 ? (
              <img
                src={`data:image/png;base64,${checkout.qr_code_base64}`}
                alt="QR Code Pix"
                className="w-52 h-52 bg-white rounded-lg p-2 mb-4"
              />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center bg-slate-800 rounded-lg mb-4">
                <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
              </div>
            )}

            <p className="text-sm text-slate-400 mb-2">
              Escaneie o QR code ou copie o código abaixo:
            </p>

            <div className="w-full bg-slate-800 rounded-lg p-3 mb-4 break-all text-xs text-slate-300 max-h-24 overflow-y-auto">
              {checkout?.copy_paste || '—'}
            </div>

            <Button
              onClick={handleCopy}
              className="w-full bg-emerald-600 hover:bg-emerald-700 mb-3"
              disabled={!checkout?.copy_paste}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" /> Copiar código Pix
                </>
              )}
            </Button>

            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Aguardando pagamento...
            </div>

            <button
              onClick={handleClose}
              className="text-slate-500 hover:text-slate-300 text-sm mt-4 underline"
            >
              Fechar
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PixCheckoutModal;
