import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet";
import { CheckCircle, Loader2, AlertTriangle } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";

const CheckoutSuccess = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Mantém estados pra UI, mas NÃO vai mais chamar verify-payment
  const [isVerifying, setIsVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const gateway = useMemo(() => (params.get("gateway") || "").toLowerCase(), [params]);
  const orderNsu = useMemo(() => params.get("order_nsu") || "", [params]);
  const eventIdFromUrl = useMemo(() => params.get("event_id") || "", [params]);

  const canVerify = useMemo(() => gateway === "infinitepay" && !!orderNsu, [gateway, orderNsu]);

  // ✅ Pixel Purchase no front (dedup com o backend via event_id)
  const purchaseSentRef = useRef(false);

  const parsePlanFromOrderNSU = useCallback((order) => {
    const parts = String(order || "").split("|");
    return parts.length >= 3 ? parts[2] : null; // monthly | quarterly
  }, []);

  const valueFromPlan = useCallback((plan) => {
    if (plan === "quarterly") return 43.9;
    if (plan === "monthly") return 15.9;
    return null;
  }, []);

  const sendPurchasePixelOnce = useCallback(() => {
    try {
      if (purchaseSentRef.current) return;

      // só dispara se vier do infinitepay e tiver order_nsu
      if (!canVerify) return;

      const eventId = (eventIdFromUrl || orderNsu || "").trim();
      if (!eventId) return;

      // evita duplicar em refresh/voltar
      const key = `dp_purchase_sent_${eventId}`;
      if (localStorage.getItem(key) === "1") {
        purchaseSentRef.current = true;
        return;
      }

      const plan = parsePlanFromOrderNSU(orderNsu);
      const value = valueFromPlan(plan);

      if (typeof value !== "number") return;

      if (typeof window !== "undefined" && typeof window.fbq === "function") {
        window.fbq(
          "track",
          "Purchase",
          {
            value,
            currency: "BRL",
            content_name: plan === "quarterly" ? "DoramasPlus Trimestral" : "DoramasPlus Padrão",
          },
          { eventID: eventId } // ✅ dedup com CAPI
        );

        localStorage.setItem(key, "1");
        purchaseSentRef.current = true;
      }
    } catch (e) {
      // não quebra a página
      console.warn("purchase pixel error:", e);
    }
  }, [canVerify, eventIdFromUrl, orderNsu, parsePlanFromOrderNSU, valueFromPlan]);

  /**
   * ✅ ALTERAÇÃO PRINCIPAL:
   * NÃO chama mais infinitepay-verify-payment.
   * Agora a liberação é feita via webhook/clever-worker.
   * Essa função só controla UX: mostra “confirmando” por alguns segundos e manda pro Dashboard.
   */
  const verifyPayment = useCallback(async () => {
    if (!canVerify) return;

    setIsVerifying(true);
    setErrorMsg("");

    try {
      // 🔒 Não chamar verify-payment (evita somar meses / duplicar liberação)
      // await supabase.functions.invoke("infinitepay-verify-payment", { body: { order_nsu: orderNsu } });

      // ⏳ Dá um tempinho pra webhook/clever-worker processar
      await new Promise((r) => setTimeout(r, 2500));

      setIsVerifying(false);

      // ✅ Em vez de tentar “verificar”, manda pro Dashboard (onde o status vai refletir quando liberar)
      navigate("/dashboard", { replace: true });
    } catch (e) {
      console.error("verify (disabled) exception:", e);
      setIsVerifying(false);
      setErrorMsg(
        "Pagamento recebido! Se sua conta ainda não liberou, aguarde 1 minuto e atualize o Dashboard."
      );
    }
  }, [canVerify, navigate]);

  useEffect(() => {
    // ✅ dispara Purchase no front assim que cair na página (não depende da verificação)
    if (canVerify) {
      sendPurchasePixelOnce();
      verifyPayment();
    }
  }, [canVerify, verifyPayment, sendPurchasePixelOnce]);

  const titleText = useMemo(() => {
    if (verified) return "Assinatura Confirmada!";
    if (canVerify && isVerifying) return "Confirmando pagamento...";
    if (canVerify && errorMsg) return "Quase lá...";
    return "Assinatura Confirmada!";
  }, [verified, canVerify, isVerifying, errorMsg]);

  const descText = useMemo(() => {
    if (verified) {
      return "Obrigado por assinar. Sua conta foi atualizada e você já tem acesso ilimitado a todos os doramas.";
    }

    if (canVerify && isVerifying) {
      return "Estamos aguardando a confirmação do Pix. Normalmente libera em instantes...";
    }

    if (canVerify && errorMsg) {
      return errorMsg;
    }

    // fallback (ex.: veio do Stripe ou entrou nessa página sem params)
    return "Obrigado por assinar. Se sua conta ainda não liberou, volte ao Dashboard e atualize a página.";
  }, [verified, canVerify, isVerifying, errorMsg]);

  return (
    <>
      <Helmet>
        <title>Assinatura Confirmada - DoramaStream</title>
      </Helmet>

      <div className="min-h-screen bg-slate-950">
        <Navbar isAuthenticated={true} />

        <div className="flex items-center justify-center min-h-[80vh] px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md w-full text-center shadow-2xl"
          >
            <div className="flex justify-center mb-6">
              {canVerify && isVerifying ? (
                <div className="bg-purple-600/20 p-4 rounded-full">
                  <Loader2 className="w-16 h-16 text-purple-400 animate-spin" />
                </div>
              ) : canVerify && errorMsg ? (
                <div className="bg-yellow-500/20 p-4 rounded-full">
                  <AlertTriangle className="w-16 h-16 text-yellow-400" />
                </div>
              ) : (
                <div className="bg-green-500/20 p-4 rounded-full">
                  <CheckCircle className="w-16 h-16 text-green-500" />
                </div>
              )}
            </div>

            <h1 className="text-3xl font-bold text-white mb-4">{titleText}</h1>

            <p className="text-slate-400 mb-8">{descText}</p>

            {/* ✅ Agora não faz sentido "tentar verificar" no backend.
                Se deu algum atraso, só manda pro Dashboard pra atualizar. */}
            {canVerify && !verified && !!errorMsg ? (
              <div className="space-y-3">
                <Button
                  onClick={() => navigate("/dashboard")}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white h-12 text-lg"
                >
                  Ir para o Dashboard
                </Button>

                <Link to="/dashboard">
                  <Button
                    variant="secondary"
                    className="w-full bg-slate-800 hover:bg-slate-700 text-white h-12 text-lg"
                  >
                    Atualizar depois
                  </Button>
                </Link>
              </div>
            ) : (
              <Link to="/dashboard">
                <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white h-12 text-lg">
                  Voltar para o Dashboard
                </Button>
              </Link>
            )}

            {/* Debug leve (não mostra tokens) */}
            {canVerify ? (
              <p className="text-xs text-slate-600 mt-5 break-all">
                Gateway: {gateway} • order_nsu: {orderNsu}
              </p>
            ) : null}
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default CheckoutSuccess;
