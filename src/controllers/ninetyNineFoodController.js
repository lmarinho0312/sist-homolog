const ninetyNineService = require('../services/ninetyNineFoodService');
const env = require('../config/env');

const recentEvents = [];

const { getDb } = require('../database/db');

async function saveEventToDb(ev) {
  try {
    const db = getDb();
    await db.execute(
      `INSERT OR REPLACE INTO food99_events (id, type, order_id, shop_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        ev.id,
        ev.type,
        ev.orderId || null,
        ev.raw?.app_shop_id || ev.raw?.data?.shop?.app_shop_id || '',
        JSON.stringify(ev.raw),
        ev.receivedAt
      ]
    );
  } catch (err) {
    console.warn('⚠️ Erro ao persistir evento 99Food no Turso:', err.message);
  }
}

async function injectOrderToDb(payload) {
  try {
    const db = getDb();
    const orderInfo = payload.data?.order_info || payload.data || {};
    const orderId = String(orderInfo.order_id || payload.order_id || '');
    if (!orderId) return;

    const existe = await db.queryOne(
      'SELECT id FROM pedidos WHERE pedido_id_origem = ? AND origem = ?',
      [orderId, '99FOOD']
    );
    if (existe) return;

    const orderIndex = orderInfo.order_index ? `#${orderInfo.order_index}` : '';
    const numeroPedido = orderIndex || orderId.slice(-6);
    const cliente = orderInfo.receive_address?.name || 'Cliente 99Food';
    const tel = orderInfo.receive_address?.phone || '';
    const rua = [orderInfo.receive_address?.street_name, orderInfo.receive_address?.street_number, orderInfo.receive_address?.complement].filter(Boolean).join(', ')
      || orderInfo.receive_address?.address
      || orderInfo.receive_address?.detail_address
      || 'Consulte o app';
    const bairro = orderInfo.receive_address?.district || '';
    const taxa = orderInfo.price?.delivery_fee ? (orderInfo.price.delivery_fee / 100) : 0;
    const rawText = JSON.stringify(payload, null, 2);

    await db.execute(
      `INSERT INTO pedidos 
       (numero_pedido, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, status, texto_bruto)
       VALUES (?, '99FOOD', ?, ?, ?, ?, ?, ?, 'disponivel', ?)`,
      [numeroPedido, orderId, cliente, rua, bairro, taxa, tel, rawText]
    );
    console.log(`✅ [99Food] Novo pedido inserido no painel de pedidos: ${numeroPedido} (${orderId})`);
  } catch (err) {
    console.warn('⚠️ Erro ao injetar pedido 99Food:', err.message);
  }
}

async function cancelOrderInDb(orderId) {
  try {
    const db = getDb();
    await db.execute(
      `UPDATE pedidos SET status = 'cancelado' WHERE pedido_id_origem = ? AND origem = '99FOOD'`,
      [String(orderId)]
    );
  } catch (err) {}
}

async function finishOrderInDb(orderId) {
  try {
    const db = getDb();
    await db.execute(
      `UPDATE pedidos SET status = 'finalizado' WHERE pedido_id_origem = ? AND origem = '99FOOD'`,
      [String(orderId)]
    );
  } catch (err) {}
}

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

  // Persiste no banco de dados e atualiza pedidos aguardando antes do término da função
  try {
    await saveEventToDb(eventRecord);

    if (eventType === 'orderNew') {
      await injectOrderToDb(payload);
    } else if (eventType === 'orderCancel') {
      await cancelOrderInDb(orderId);
    } else if (eventType === 'orderFinish') {
      await finishOrderInDb(orderId);
    }
  } catch (err) {
    console.error('⚠️ Falha ao salvar evento 99Food no banco:', err);
  }

  // Responde imediatamente com 200 OK para satisfazer a 99Food
  return res.json({
    errno: 0,
    errmsg: 'ok',
    status: 'ok',
    receivedAt: timestamp
  });
}

async function listRecentEvents(req, res) {
  let dbEvents = [];
  try {
    const db = getDb();
    const rows = await db.query('SELECT * FROM food99_events ORDER BY created_at DESC LIMIT 50');
    dbEvents = (rows || []).map(r => {
      let parsed = {};
      try { parsed = JSON.parse(r.payload); } catch (e) {}
      return {
        id: r.id,
        type: r.type,
        orderId: r.order_id,
        receivedAt: r.created_at,
        raw: parsed
      };
    });
  } catch (err) {}

  const map = new Map();
  [...recentEvents, ...dbEvents].forEach(ev => {
    if (ev && ev.id && !map.has(ev.id)) map.set(ev.id, ev);
  });

  const merged = Array.from(map.values()).sort((a,b) => new Date(b.receivedAt) - new Date(a.receivedAt));

  return res.json({
    total: merged.length,
    events: merged
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

/**
 * Ação: Gera URL oficial de autorização para o lojista vincular a loja
 * GET /api/99food/stores/auth-url
 */
async function getAuthorizationUrlAction(req, res) {
  const appId = req.query?.appId || req.body?.appId || env.FOOD99_APP_ID;
  try {
    const url = await ninetyNineService.getStoreAuthorizationPageUrl(appId);
    return res.json({ success: true, appId, url });
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
  getOrderDetailsAction,
  getAuthorizationUrlAction
};
