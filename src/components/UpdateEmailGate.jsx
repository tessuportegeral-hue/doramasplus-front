// src/components/UpdateEmailGate.jsx
//
// Detecta usuários criados via "conta rápida" — cujo email de login tem o
// formato <telefone>@doramasplus.com — e oferece (uma vez por sessão) a
// troca pelo email real, via UpdateEmailModal.
//
// "Agora não" fecha e marca a sessão como dispensada (sessionStorage), então
// não aparece de novo até o usuário abrir uma nova sessão/aba.

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/SupabaseAuthContext";
import UpdateEmailModal from "@/components/UpdateEmailModal";

const QUICK_ACCOUNT_DOMAIN = "@doramasplus.com";
const DISMISS_KEY = "dp_update_email_dismissed";

const isQuickAccountEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase()
    .endsWith(QUICK_ACCOUNT_DOMAIN);

export default function UpdateEmailGate() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || !isQuickAccountEmail(user.email)) {
      setOpen(false);
      return;
    }

    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {}

    if (!dismissed) setOpen(true);
  }, [user]);

  const dismissForSession = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  const handleClose = () => {
    // Fechar ("Agora não" ou ✕): não mostra de novo nesta sessão.
    dismissForSession();
    setOpen(false);
  };

  const handleUpdated = () => {
    // Sucesso: também não mostra de novo nesta sessão. O novo email só
    // reflete em user.email depois do refresh do token, então o sessionStorage
    // evita que o modal pisque novamente enquanto isso.
    dismissForSession();
  };

  return (
    <UpdateEmailModal
      isOpen={open}
      onClose={handleClose}
      onUpdated={handleUpdated}
    />
  );
}
