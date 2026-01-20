import React from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { XCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

const CheckoutCanceled = () => {
  return (
    <>
      <Helmet>
        <title>Checkout Cancelado - DoramaStream</title>
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
              <div className="bg-red-500/20 p-4 rounded-full">
                <XCircle className="w-16 h-16 text-red-500" />
              </div>
            </div>
            
            <h1 className="text-3xl font-bold text-white mb-4">Pagamento Cancelado</h1>
            <p className="text-slate-400 mb-8">
              O processo de assinatura não foi concluído. Se você encontrou algum problema, por favor tente novamente ou entre em contato com o suporte.
            </p>
            
            <div className="flex flex-col gap-3">
              <Link to="/dashboard">
                <Button variant="outline" className="w-full border-slate-700 text-white hover:bg-slate-800 h-12">
                  Voltar para o Dashboard
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
};

export default CheckoutCanceled;