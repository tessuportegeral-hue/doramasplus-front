import React, { useState, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";
import { useToast } from "@/components/ui/use-toast";
import { getDeviceId } from "@/lib/deviceId";
import { Loader2, Eye, EyeOff, User, Lock, Shield, Monitor, Smartphone, Tv } from "lucide-react";

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callFn(fn, body = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("no_session");
  const res = await fetch(`${FN_BASE}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return json;
}

function DeviceIcon({ name }) {
  const n = (name || "").toLowerCase();
  if (n.includes("iphone") || n.includes("ipad") || n.includes("android")) {
    return <Smartphone className="w-5 h-5 text-purple-400" />;
  }
  if (n.includes("smart tv") || n.includes("tv")) {
    return <Tv className="w-5 h-5 text-purple-400" />;
  }
  return <Monitor className="w-5 h-5 text-purple-400" />;
}

function formatDate(raw) {
  if (!raw) return "—";
  try {
    return new Date(raw).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

export default function Configuracoes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const myDeviceId = getDeviceId();

  // ── Card 1: Conta ──
  const [profileName, setProfileName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!user) return;
    const loadProfile = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", user.id)
        .maybeSingle();
      const name = data?.name || user?.user_metadata?.name || "";
      setProfileName(name);
      setOriginalName(name);
    };
    loadProfile();
  }, [user]);

  const handleSaveName = async () => {
    if (!user) return;
    setSavingName(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ name: profileName })
        .eq("id", user.id);
      if (error) throw error;
      setOriginalName(profileName);
      toast({ title: "Nome atualizado com sucesso." });
    } catch (err) {
      toast({ title: "Erro ao salvar nome", description: err.message, variant: "destructive" });
    } finally {
      setSavingName(false);
    }
  };

  // ── Card 2: Senha ──
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Senha muito curta", description: "Mínimo 6 caracteres.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Senhas diferentes", description: "A confirmação não confere.", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    try {
      const data = await callFn("change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      if (!data.ok) throw new Error(data.message || "Erro desconhecido");
      toast({ title: "Senha alterada.", description: "Você será desconectado de todos os dispositivos." });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setTimeout(async () => {
        await supabase.auth.signOut();
        navigate("/login");
      }, 2000);
    } catch (err) {
      toast({ title: "Erro ao alterar senha", description: err.message, variant: "destructive" });
    } finally {
      setSavingPassword(false);
    }
  };

  // ── Card 3: Dispositivos ──
  const [devicesTab, setDevicesTab] = useState("active");
  const [activeDevices, setActiveDevices] = useState([]);
  const [historyDevices, setHistoryDevices] = useState([]);
  const [maxStreams, setMaxStreams] = useState(1);
  const [planName, setPlanName] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [revokingId, setRevokingId] = useState(null);
  const [showRevokeAll, setShowRevokeAll] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const data = await callFn("list-devices");
      setActiveDevices(data.active || []);
      setHistoryDevices(data.history || []);
      setMaxStreams(data.max_streams ?? 1);
      setPlanName(data.plan_name || "");
    } catch (err) {
      toast({ title: "Erro ao carregar dispositivos", description: err.message, variant: "destructive" });
    } finally {
      setLoadingDevices(false);
    }
  }, [toast]);

  useEffect(() => {
    if (user) loadDevices();
  }, [user, loadDevices]);

  const handleRevoke = async (deviceId) => {
    setRevokingId(deviceId);
    try {
      await callFn("revoke-device", { device_id: deviceId });
      toast({ title: "Dispositivo desconectado." });
      loadDevices();
    } catch (err) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevokingAll(true);
    try {
      await callFn("revoke-all-devices", { keep_device_id: myDeviceId });
      toast({ title: "Todos os outros dispositivos foram desconectados." });
      setShowRevokeAll(false);
      loadDevices();
    } catch (err) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setRevokingAll(false);
    }
  };

  const cardClass = "bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6";
  const inputBase =
    "w-full h-11 text-sm bg-zinc-900 text-slate-50 placeholder:text-slate-500 border border-zinc-700 rounded-lg px-3 " +
    "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500";

  return (
    <>
      <Helmet><title>Configurações — DoramasPlus</title></Helmet>
      <div className="min-h-screen bg-zinc-950 text-slate-50 px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-2xl font-bold text-white">Configurações</h1>

          {/* ── Card 1: Conta ── */}
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-1">
              <User className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-semibold">Configuração da Conta</h2>
            </div>
            <p className="text-sm text-zinc-400 mb-5">Gerencie suas informações pessoais e credenciais.</p>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-zinc-300 mb-1 block">Nome</label>
                <input
                  type="text"
                  placeholder="Usuário Anônimo"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className="text-sm text-zinc-300 mb-1 block">E-mail</label>
                <input
                  type="email"
                  value={user?.email || ""}
                  readOnly
                  className={inputBase + " opacity-60 cursor-not-allowed"}
                />
              </div>
              {profileName !== originalName && (
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-60"
                >
                  {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Salvar
                </button>
              )}
            </div>
          </div>

          {/* ── Card 2: Senha ── */}
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-1">
              <Lock className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-semibold">Alterar Senha</h2>
            </div>
            <p className="text-sm text-zinc-400 mb-5">Atualize sua senha de acesso.</p>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="text-sm text-zinc-300 mb-1 block">Senha atual</label>
                <div className="relative">
                  <input
                    type={showPasswords ? "text" : "password"}
                    placeholder="Digite sua senha atual"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className={inputBase + " pr-10"}
                  />
                  <button type="button" onClick={() => setShowPasswords((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100">
                    {showPasswords ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm text-zinc-300 mb-1 block">Nova senha</label>
                <input
                  type={showPasswords ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputBase}
                />
              </div>
              <div>
                <label className="text-sm text-zinc-300 mb-1 block">Confirmar nova senha</label>
                <input
                  type={showPasswords ? "text" : "password"}
                  placeholder="Repita a nova senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputBase}
                />
              </div>
              <button
                type="submit"
                disabled={savingPassword}
                className="w-full h-11 rounded-lg bg-gradient-to-r from-purple-500 to-purple-700 hover:from-purple-600 hover:to-purple-800 text-white font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
              >
                {savingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Atualizar Senha
              </button>
            </form>
          </div>

          {/* ── Card 3: Dispositivos ── */}
          <div className={cardClass}>
            <div className="flex items-center gap-3 mb-1">
              <Shield className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-semibold">Gerenciar Dispositivos</h2>
            </div>
            <p className="text-sm text-zinc-400 mb-1">Gerencie os dispositivos que têm acesso à sua conta.</p>

            {loadingDevices ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-300 mb-4">
                  <span className="font-semibold text-white">{activeDevices.length}</span> de{" "}
                  <span className="font-semibold text-white">{maxStreams}</span> dispositivo(s) ativo(s)
                </p>

                {/* Tabs */}
                <div className="flex gap-2 mb-4">
                  {["active", "history"].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setDevicesTab(tab)}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                        devicesTab === tab
                          ? "bg-purple-600 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {tab === "active" ? "Dispositivos Ativos" : "Histórico"}
                    </button>
                  ))}
                </div>

                {devicesTab === "active" && (
                  <div className="space-y-3">
                    {activeDevices.length === 0 ? (
                      <p className="text-sm text-zinc-500">Nenhum dispositivo ativo no momento.</p>
                    ) : (
                      activeDevices.map((d) => {
                        const isCurrent = d.device_id === myDeviceId;
                        return (
                          <div key={d.device_id} className="flex items-center justify-between gap-3 bg-zinc-800/60 rounded-xl p-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <DeviceIcon name={d.device_name} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium truncate">{d.device_name || "Dispositivo"}</span>
                                  {isCurrent && (
                                    <span className="text-[10px] font-bold bg-purple-600/80 text-white px-2 py-0.5 rounded-full">Atual</span>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                  Último acesso: {formatDate(d.last_heartbeat)}
                                </p>
                                {d.ip_address && (
                                  <p className="text-xs text-zinc-600">IP: {d.ip_address}</p>
                                )}
                              </div>
                            </div>
                            {!isCurrent && (
                              <button
                                onClick={() => handleRevoke(d.device_id)}
                                disabled={revokingId === d.device_id}
                                className="flex-shrink-0 text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                              >
                                {revokingId === d.device_id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Desconectar"}
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {devicesTab === "history" && (
                  <div className="space-y-3">
                    {historyDevices.length === 0 ? (
                      <p className="text-sm text-zinc-500">Nenhum histórico nos últimos 60 dias.</p>
                    ) : (
                      historyDevices.map((d, i) => (
                        <div key={d.device_id ?? i} className="flex items-center gap-3 bg-zinc-800/40 rounded-xl p-3">
                          <DeviceIcon name={d.device_name} />
                          <div className="min-w-0">
                            <span className="text-sm font-medium truncate block">{d.device_name || "Dispositivo"}</span>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              Último acesso: {formatDate(d.last_seen_at)}
                            </p>
                            {d.ip_address && (
                              <p className="text-xs text-zinc-600">IP: {d.ip_address}</p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeDevices.length > 1 && (
                  <div className="mt-5">
                    {!showRevokeAll ? (
                      <button
                        onClick={() => setShowRevokeAll(true)}
                        className="w-full py-2.5 rounded-lg border border-red-800 text-red-400 hover:bg-red-950/40 text-sm font-medium transition"
                      >
                        Desconectar de todos os dispositivos
                      </button>
                    ) : (
                      <div className="rounded-xl bg-red-950/30 border border-red-800 p-4 space-y-3">
                        <p className="text-sm text-red-200">
                          Isso desconectará todos os outros dispositivos. Você continuará conectado neste.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={handleRevokeAll}
                            disabled={revokingAll}
                            className="flex-1 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
                          >
                            {revokingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            Confirmar
                          </button>
                          <button
                            onClick={() => setShowRevokeAll(false)}
                            className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5 rounded-xl bg-zinc-800/40 border border-zinc-700/50 p-4 text-xs text-zinc-400 space-y-1">
                  <p><span className="text-zinc-300 font-medium">Plano Padrão:</span> 1 dispositivo por vez</p>
                  <p><span className="text-zinc-300 font-medium">Plano Premium:</span> até 3 dispositivos simultâneos</p>
                  {planName && <p className="text-purple-400 font-medium mt-1">Seu plano: {planName}</p>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
