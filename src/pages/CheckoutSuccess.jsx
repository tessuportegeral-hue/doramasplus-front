import React from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { CheckCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

const CheckoutSuccess = () => {
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
              <div className="bg-green-500/20 p-4 rounded-full">
                <CheckCircle className="w-16 h-16 text-green-500" />
              </div>
            </div>
            
            <h1 className="text-3xl font-bold text-white mb-4">Assinatura Confirmada!</h1>
            <p className="text-slate-400 mb-8">
              Obrigado por assinar o DoramaStream Premium. Sua conta foi atualizada e você já tem acesso ilimitado a todos os doramas.
            </p>
            
            <Link to="/dashboard">
              <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white h-12 text-lg">
                Voltar para o Dashboard
              </Button>
            </Link>
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default CheckoutSuccess;