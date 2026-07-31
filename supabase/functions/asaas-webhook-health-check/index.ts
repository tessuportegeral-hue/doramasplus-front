// asaas-webhook-health-check: roda a cada 5min via pg_cron. Consulta DIRETO
// na Asaas (GET /v3/webhooks) se a fila de entrega desse webhook está
// pausada (`interrupted`) — Asaas pausa a fila inteira depois de 15
// respostas não-200 seguidas (ver asaas-webhook-queue-pause), e quando
// pausada NENHUMA venda nova libera acesso sozinha até alguém reativar
// manualmente no painel Asaas. Isso é dinheiro parado até alguém notar.
//
// Também acompanha `penalizedRequestsCount` (contador de falhas subindo
// rumo aos 15) como aviso ANTECIPADO, antes de pausar de vez.
//
// Alerta por email + WhatsApp (admin-whatsapp-notify) na hora — não espera
// o relatório diário. Usa system_alert_state pra não floodar (só reavisa
// a cada 30min enquanto o problema persistir, ou quando o estado muda).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY") || "";
const CRON_SECRET = "dp_asaas_wh_health_t4n8q2";
const PENALIZED_WARNING_THRESHOLD = 5; // aviso antecipado bem antes do limite de 15

async function notify(message: string) {
  await fetch(`${SUPABASE_URL}/functions/v1/admin-whatsapp-notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-check-secret": "dp_admin_notify_h4t8w2" },
    body: JSON.stringify({ message }),
  }).catch((e) => console.error("[asaas-webhook-health-check] notify fail:", String(e)));
}

async function getAlertState(key: string): Promise<{ state: string; last_alert_at: string | null }> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/system_alert_state?key=eq.${key}&select=state,last_alert_at`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const data = await resp.json().catch(() => []);
  return data?.[0] || { state: "ok", last_alert_at: null };
}

async function setAlertState(key: string, state: string, alerted: boolean) {
  await fetch(`${SUPABASE_URL}/rest/v1/system_alert_state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      key,
      state,
      ...(alerted ? { last_alert_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }),
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  if (!ASAAS_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "missing_ASAAS_API_KEY" }), { status: 500 });
  }

  try {
    const res = await fetch("https://api.asaas.com/v3/webhooks", {
      headers: { access_token: ASAAS_API_KEY },
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      await notify(`🚨 DoramasPlus: falha ao consultar status do webhook Asaas (status ${res.status}). Verificar manualmente no painel Asaas.`);
      return new Response(JSON.stringify({ ok: false, error: "asaas_api_error", status: res.status }), { status: 200 });
    }

    const webhooks: any[] = data?.data || [];
    const interrupted = webhooks.some((w) => w.interrupted === true);
    const maxPenalized = Math.max(0, ...webhooks.map((w) => Number(w.penalizedRequestsCount || 0)));
    const isProblem = interrupted || maxPenalized >= PENALIZED_WARNING_THRESHOLD;

    const key = "asaas_webhook_queue";
    const prev = await getAlertState(key);
    const cooldownOk = !prev.last_alert_at || Date.now() - new Date(prev.last_alert_at).getTime() > 30 * 60 * 1000;
    const stateChanged = prev.state !== (isProblem ? "problem" : "ok");

    if (isProblem && (stateChanged || cooldownOk)) {
      const msg = interrupted
        ? `🚨 DoramasPlus: fila de webhook da Asaas está PAUSADA (interrupted=true)! Vendas novas não liberam acesso sozinhas até reativar manualmente (Asaas > Integrações > Webhooks > interrupted=false).`
        : `⚠️ DoramasPlus: webhook Asaas acumulando falhas (${maxPenalized} solicitações penalizadas) — se chegar a 15, a fila pausa sozinha. Verificar logs do asaas-webhook agora.`;
      await notify(msg);
      await setAlertState(key, "problem", true);
    } else if (!isProblem && prev.state !== "ok") {
      await setAlertState(key, "ok", false);
    }

    return new Response(
      JSON.stringify({ ok: true, interrupted, max_penalized: maxPenalized, webhooks_count: webhooks.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "internal", details: String(e) }), { status: 500 });
  }
});
