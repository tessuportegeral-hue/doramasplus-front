import React from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const PremiumGuard = ({ children }) => {
  const { user, isAuthenticated, isPremium, loading, checkingPremium } = useAuth();

  if (loading || checkingPremium) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-purple-500 mb-4" />
        <p className="text-slate-400 text-lg">Verificando sua assinatura...</p>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    // If not authenticated, redirect to login page.
    return <Navigate to="/login" replace />;
  }

  if (!isPremium) {
    // If authenticated but not premium, redirect to plans page.
    return <Navigate to="/plans" replace />;
  }
  
  // If authenticated and premium, render the content.
  return children;
};

export default PremiumGuard;