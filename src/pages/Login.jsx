import React, { useState } from "react";
import { Helmet } from "react-helmet";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Eye, EyeOff } from "lucide-react";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // ✅ Agora são 2 campos (WhatsApp + Email)
  const [whatsapp, setWhatsapp] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // ✅ device_id fixo por dispositivo (blindado)
  const DEVICE_KEY = "dp_device_id";

  const getDeviceId = () => {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id =
          (typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`) + "";
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      console.warn("[device] localStorage indisponível:", e);
      const fallback =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`) + "";
      return fallback;
    }
  };

  const digitsOnly = (v: any) => String(v || "").replace(/\D/g, "");

  // ✅ Converte WhatsApp em email fake
  const whatsappToFakeEmail = (raw: any) => {
    const v = String(raw || "").trim();
    if (!v) return "";

    let d = digitsOnly(v);

    // ✅ se o cara digitar +55... remove o 55
    if (d.length > 11 && d.startsWith("55")) d = d.slice(2);

    // precisa ter pelo menos 10 dígitos (DDD + número)
    if (d.length < 10) return "";

    return `${d}@doramasplus.com`;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const email = String(emailInput || "").trim().toLowerCase();
    const wpp = String(whatsapp || "").trim();

    if ((!email && !wpp) || !password) {
      toast({
        title: "Atenção",
        description: "Preencha WhatsApp ou email e senha.",
        variant: "destructive",
      });
      return;
    }

    // ✅ Prioriza EMAIL se foi preenchido
    let finalEmail = "";
    if (email) {
      finalEmail = email;
    } else {
      finalEmail = whatsappToFakeEmail(wpp);
      if (!finalEmail) {
        toast({
          title: "WhatsApp inválido",
          description:
            "Digite seu WhatsApp com DDD (somente números). Ex: 11999999999",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setLoading(true);

      // ✅ login
      const { data, error } = await supabase.auth.signInWithPassword({
        email: finalEmail,
        password,
      });

      if (error) {
        console.error("Erro login:", error);
        toast({
          title: "Erro ao entrar",
          description: "WhatsApp/email ou senha incorretos.",
          variant: "destructive",
        });
        return;
      }

      // ✅ registra o device autorizado (1 dispositivo por vez)
      try {
        const userId = data?.user?.id;
        if (userId) {
          const deviceId = getDeviceId();

          const { error: sessErr } = await supabase.from("user_sessions").upsert(
            {
              user_id: userId,
              device_id: deviceId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );

          if (sessErr) {
            console.error("[user_sessions] erro ao registrar device:", sessErr);
          }
        }
      } catch (e2) {
        console.error("[user_sessions] exception ao registrar device:", e2);
      }

      navigate("/");
    } catch (err) {
      console.error("Erro inesperado:", err);
      toast({
        title: "Erro inesperado",
        description: "Tente novamente mais tarde.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Entrar — DoramaStream</title>
      </Helmet>

      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50 px-4">
        <div className="max-w-md w-full bg-slate-900/95 p-6 rounded-2xl border border-slate-800 shadow-lg">
          <h1 className="text-3xl font-bold mb-1 text-purple-400">Bem-vindo</h1>
          <p className="text-slate-300 text-sm mb-6">
            Entre na sua conta para continuar.
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* ✅ WhatsApp */}
            <div>
              <label className="text-sm mb-1 block">WhatsApp</label>
              <Input
                type="tel"
                inputMode="numeric"
                placeholder="Ex: 11999999999"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="h-12 text-base bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Use com DDD (somente números). Se preferir, use o email abaixo.
              </p>
            </div>

            {/* ✅ Email */}
            <div>
              <label className="text-sm mb-1 block">Email</label>
              <Input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="Ex: email@..."
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="h-12 text-base bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500"
              />
            </div>

            {/* SENHA + OLHINHO */}
            <div>
              <label className="text-sm mb-1 block">Senha</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 text-base pr-10 bg-slate-900 text-slate-50 placeholder:text-slate-400 border border-slate-600 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:border-purple-500"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-90 hover:opacity-100"
                >
                  {showPassword ? (
                    <Eye className="w-5 h-5 text-slate-100" />
                  ) : (
                    <EyeOff className="w-5 h-5 text-slate-100" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>

          <Link
            to="/reset-password"
            className="block mt-4 text-sm text-purple-400 hover:underline text-center"
          >
            Esqueci minha senha
          </Link>

          <p className="text-slate-400 text-sm mt-6 text-center">
            Não tem conta?{" "}
            <Link to="/signup" className="text-purple-400 hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default Login;
