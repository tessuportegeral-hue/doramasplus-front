import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet";
import { CheckCircle, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";

const CheckoutSuccess = () => {
  const location = useLocation();

  // status: "checking" | "active" | "pending"
  // - checking: ainda consultando o banco
  // - active:   assinatura confirmada (status ativo E não expirada)
  // - pending:  pagamento ainda não refletiu no banco
  const [status, setStatus] = useState("checking");
  const [rechecking, setRechecking] = useState(false);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const gateway = useMemo(() => (params.get("gateway") || "").toLowerCase(), [params]);
  const orderNsu = useMemo(() => params.get("order_nsu") || "", [params]);

  // ✅ Mantido como estava: Purchase fica SOMENTE no backend/CAPI.
  // (helper preservado, mas não disparado no front)
  const purchaseSentRef = useRef(false);
  void purchaseSentRef;

  /**
   * ✅ VERIFICAÇÃO REAL:
   * Antes de mostrar "Assinatura Confirmada", consulta a tabela `subscriptions`
   * do usuário logado e confirma que existe assinatura ativa e não expirada.
   * Espelha a mesma regra do SupabaseAuthContext.checkPremiumStatus
   * (status ∈ {active, trialing, paid} E (end_at || current_period_end) > now).
   */
  const checkSubscription = useCallback(async () => {
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        setStatus("pending");
        return;
      }

      const { data, error } = await supabase
        .from("subscriptions")
        .select("status, end_at, current_period_end, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) {
        console.error("Erro ao verificar assinatura:", error);
        setStatus("pending");
        return;
      }

      const subs = Array.isArray(data) ? data : [];
      const now = new Date();
      const ACTIVE_STATUSES = new Set(["active", "trialing", "paid"]);

      const hasActiveSub = subs.some((sub) => {
        const st = String(sub?.status ?? "").trim().toLowerCase();
        if (!ACTIVE_STATUSES.has(st)) return false;
        const v = sub?.end_at || sub?.current_period_end;
        if (!v) return true; // ativa sem data de fim => considera válida
        const d = new Date(v);
        return !Number.isNaN(d.getTime()) && d > now;
      });

      setStatus(hasActiveSub ? "active" : "pending");
    } catch (e) {
      console.error("Erro ao verificar assinatura (fatal):", e);
      setStatus("pending");
    }
  }, []);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  const handleRecheck = useCallback(async () => {
    if (rechecking) return;
    setRechecking(true);
    setStatus("checking");
    await checkSubscription();
    setRechecking(false);
  }, [rechecking, checkSubscription]);

  const isChecking = status === "checking";
  const isActive = status === "active";
  const isPending = status === "pending";

  const titleText = useMemo(() => {
    if (isActive) return "Assinatura Confirmada!";
    if (isPending) return "Processando pagamento...";
    return "Verificando pagamento...";
  }, [isActive, isPending]);

  const descText = useMemo(() => {
    if (isActive) {
      return "Obrigado por assinar. Sua conta foi atualizada e você já tem acesso ilimitado a todos os doramas.";
    }
    if (isPending) {
      return "Seu pagamento ainda está sendo processado e pode levar alguns instantes para liberar. Clique em recarregar para verificar novamente.";
    }
    return "Estamos confirmando sua assinatura. Só um instante...";
  }, [isActive, isPending]);

  return (
    <>
      <Helmet>
        <title>Status da Assinatura - DoramasPlus</title>
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
              {isActive ? (
                <div className="bg-green-500/20 p-4 rounded-full">
                  <CheckCircle className="w-16 h-16 text-green-500" />
                </div>
              ) : isPending ? (
                <div className="bg-yellow-500/20 p-4 rounded-full">
                  <AlertTriangle className="w-16 h-16 text-yellow-400" />
                </div>
              ) : (
                <div className="bg-purple-600/20 p-4 rounded-full">
                  <Loader2 className="w-16 h-16 text-purple-400 animate-spin" />
                </div>
              )}
            </div>

            <h1 className="text-3xl font-bold text-white mb-4">{titleText}</h1>

            <p className="text-slate-400 mb-8">{descText}</p>

            {isActive ? (
              <Link to="/dashboard">
                <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white h-12 text-lg">
                  Voltar para o Dashboard
                </Button>
              </Link>
            ) : isPending ? (
              <div className="space-y-3">
                <Button
                  onClick={handleRecheck}
                  disabled={rechecking}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white h-12 text-lg"
                >
                  {rechecking ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="w-5 h-5 mr-2" />
                      Recarregar
                    </>
                  )}
                </Button>

                <Link to="/dashboard">
                  <Button
                    variant="secondary"
                    className="w-full bg-slate-800 hover:bg-slate-700 text-white h-12 text-lg"
                  >
                    Ir para o Dashboard
                  </Button>
                </Link>
              </div>
            ) : (
              <Button
                disabled
                className="w-full bg-purple-600/60 text-white h-12 text-lg cursor-not-allowed"
              >
                <Loader2 className="w-5 h-5 animate-spin" />
              </Button>
            )}

            {/* Debug leve (não mostra tokens) */}
            {gateway || orderNsu ? (
              <p className="text-xs text-slate-600 mt-5 break-all">
                Gateway: {gateway || "—"} • order_nsu: {orderNsu || "—"}
              </p>
            ) : null}
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default CheckoutSuccess;
