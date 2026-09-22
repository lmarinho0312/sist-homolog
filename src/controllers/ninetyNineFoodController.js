/**
 * Controller de Integracao 99Food / DiDi Food Open Platform
 */

const recentEvents = [];

/**
 * Endpoint de Webhook da 99Food
 * Aceita GET (para validacoes/ping de URL pela 99) e POST (para eventos de pedidos)
 */
async function handleWebhook(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query?.challenge || req.query?.echo || 'ok';
    return res.json({ status: 'ok', message: '99Food Webhook online', challenge });
  }

  const payload = req.body || {};
  console.log(`[99Food Webhook] Evento recebido:`, JSON.stringify(payload));

  recentEvents.unshift({
    id: payload.event_id || payload.id || ('99-' + Date.now()),
    type: payload.event_type || payload.type || 'UNKNOWN',
    orderId: payload.order_id || payload.orderId || payload.data?.order_id,
    receivedAt: new Date().toISOString(),
    raw: payload
  });

  if (recentEvents.length > 100) recentEvents.pop();

  return res.json({
    errno: 0,
    errmsg: 'ok',
    status: 'ok',
    receivedAt: new Date().toISOString()
  });
}

function listRecentEvents(req, res) {
  return res.json({
    total: recentEvents.length,
    events: recentEvents
  });
}

function checkStatus(req, res) {
  return res.json({
    ok: true,
    platform: '99Food / DiDi Food Open Platform',
    webhookUrl: 'https://sist-homolog.vercel.app/api/99food/webhook',
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  handleWebhook,
  listRecentEvents,
  checkStatus
};
