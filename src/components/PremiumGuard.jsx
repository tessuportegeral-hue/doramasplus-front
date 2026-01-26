import React from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/SupabaseAuthContext";

const PremiumGuard = ({ children }) => {
  const { user, isAuthenticated, isPremium, loading, checkingPremium } = useAuth();

  // ✅ Primeiro decide autenticação
  if (!loading && (!isAuthenticated || !user)) {
    return <Navigate to="/login" replace />;
  }

  // ✅ Se ainda tá carregando auth ou premium, segura aqui
  if (loading || checkingPremium) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-purple-500 mb-4" />
        <p className="text-slate-400 text-lg">Verificando sua assinatura...</p>
      </div>
    );
  }

  // ✅ Agora sim: premium
  if (!isPremium) {
    return <Navigate to="/plans" replace />;
  }

  return children;
};

export default PremiumGuard;
