const ninetyNineService = require('../services/ninetyNineFoodService');
const env = require('../config/env');

const recentEvents = [];

/**
 * Endpoint de Webhook da 99Food
 * Aceita GET (para validações/ping de URL pela 99) e POST (para eventos de pedidos)
 */
async function handleWebhook(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query?.challenge || req.query?.echo || 'ok';
    return res.json({ status: 'ok', message: '99Food Webhook online', challenge });
  }

  let payload = req.body || {};
  
  // Se recebemos string raw no body, normalizamos inteiros de 64 bits para string
  if (typeof payload === 'string') {
    try {
      const fixed = payload.replace(/"(order_id|app_id|shop_id|event_id)":\s*(\d{15,})/g, '"$1":"$2"');
      payload = JSON.parse(fixed);
    } catch (e) {
      try { payload = JSON.parse(payload); } catch (err) {}
    }
  }

  const eventType = payload.type || payload.event_type || 'UNKNOWN';
  const orderId = payload.data?.order_id || payload.data?.order_info?.order_id || payload.order_id || payload.orderId;
  const timestamp = new Date().toISOString();

  console.log(`📥 [99Food Webhook] Tipo: ${eventType} | Pedido ID: ${orderId} | às ${timestamp}`);

  const eventRecord = {
    id: payload.event_id || ('99-' + Date.now()),
    type: eventType,
    orderId: String(orderId || ''),
    orderIndex: payload.data?.order_info?.order_index || null,
    totalPrice: payload.data?.order_info?.price?.order_price ? (payload.data.order_info.price.order_price / 100).toFixed(2) : null,
    receivedAt: timestamp,
    raw: payload
  };

  recentEvents.unshift(eventRecord);
  if (recentEvents.length > 100) recentEvents.pop();

  // Responde imediatamente com 200 OK para satisfazer a 99Food
  return res.json({
    errno: 0,
    errmsg: 'ok',
    status: 'ok',
    receivedAt: timestamp
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
    appId: env.FOOD99_APP_ID,
    shopId: env.FOOD99_SHOP_ID,
    appShopId: env.FOOD99_APP_SHOP_ID,
    webhookUrl: 'https://sist-homolog.vercel.app/api/99food/webhook',
    timestamp: new Date().toISOString()
  });
}

/**
 * Ação manual: Confirma pedido na 99Food
 * POST /api/99food/orders/confirm
 */
async function confirmOrderAction(req, res) {
  const orderId = req.body?.orderId || req.query?.orderId;
  if (!orderId) return res.json(400, { error: 'orderId é obrigatório' });

  try {
    const result = await ninetyNineService.confirmOrder(orderId);
    return res.json({ success: true, orderId, result });
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Ação manual: Notifica que o pedido está pronto
 * POST /api/99food/orders/ready
 */
async function readyOrderAction(req, res) {
  const orderId = req.body?.orderId || req.query?.orderId;
  if (!orderId) return res.json(400, { error: 'orderId é obrigatório' });

  try {
    const result = await ninetyNineService.orderReady(orderId);
    return res.json({ success: true, orderId, result });
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Ação manual: Despacha o pedido para entrega
 * POST /api/99food/orders/dispatch
 */
async function dispatchOrderAction(req, res) {
  const orderId = req.body?.orderId || req.query?.orderId;
  const courier = req.body?.courier || {};
  if (!orderId) return res.json(400, { error: 'orderId é obrigatório' });

  try {
    const result = await ninetyNineService.dispatchOrder(orderId, courier);
    return res.json({ success: true, orderId, result });
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Ação manual: Cancela o pedido com motivo
 * POST /api/99food/orders/cancel
 */
async function cancelOrderAction(req, res) {
  const { orderId, reasonId, reasonText } = req.body || {};
  if (!orderId) return res.json(400, { error: 'orderId é obrigatório' });

  try {
    const result = await ninetyNineService.cancelOrder(orderId, reasonId, reasonText);
    return res.json({ success: true, orderId, result });
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Ação: Obtém detalhes completos de um pedido
 * GET /api/99food/orders/details?orderId=...
 */
async function getOrderDetailsAction(req, res) {
  const orderId = req.query?.orderId || req.body?.orderId;
  if (!orderId) return res.json(400, { error: 'orderId é obrigatório' });

  try {
    const result = await ninetyNineService.getOrderDetails(orderId);
    return res.json({ success: true, orderId, result });
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

module.exports = {
  handleWebhook,
  listRecentEvents,
  checkStatus,
  confirmOrderAction,
  readyOrderAction,
  dispatchOrderAction,
  cancelOrderAction,
  getOrderDetailsAction
};
