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

    const rawOrderIndex = orderInfo.order_index ? String(orderInfo.order_index).replace(/^#+/, '').trim() : '';
    const numeroPedido = rawOrderIndex || orderId.slice(-6);

    // 1. Busca pedido ÚNICA E EXCLUSIVAMENTE pelo ID global único da 99Food (19 dígitos)
    let existe = await db.queryOne(
      `SELECT id, numero_pedido, status, motoboy_id FROM pedidos 
       WHERE origem = '99FOOD' AND pedido_id_origem = ?
       ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    // 2. Se não achou pelo ID oficial, só busca por número se for pedido de HOJE e ainda no balcão
    if (!existe && numeroPedido) {
      existe = await db.queryOne(
        `SELECT id, numero_pedido, status, motoboy_id FROM pedidos 
         WHERE origem = '99FOOD' 
           AND numero_pedido IN (?, ?)
           AND DATE(COALESCE(criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
           AND status IN ('disponivel', 'aguardando_retirada', 'pronto', 'em_preparo')
         ORDER BY id DESC LIMIT 1`,
        [numeroPedido, `#${numeroPedido}`]
      );
    }

    const addr = orderInfo.receive_address || {};
    const cliente = addr.name || [addr.first_name, addr.last_name].filter(Boolean).join(' ') || 'Cliente 99Food';
    const tel = addr.virtual_phone_number || addr.phone || '';
    const loc = addr.locator ? String(addr.locator).trim() : null;
    
    // Concatena endereço completo incluindo número, complemento e ponto de referência
    const refComp = [addr.complement, addr.reference || addr.house_number].filter(Boolean).join(' - ');
    const ruaCompleta = [addr.street_name, addr.street_number, refComp].filter(Boolean).join(', ')
      || addr.poi_address
      || addr.poi_display_name
      || 'Consulte o app';
    
    const bairro = addr.district || '';
    // Taxa de entrega da loja ou taxa cobrada
    const taxaCents = orderInfo.price?.store_charged_delivery_price || orderInfo.price?.delivery_price || orderInfo.price?.delivery_fee || 0;
    const taxa = taxaCents ? (taxaCents / 100) : 0;
    const rawText = JSON.stringify(payload, null, 2);

    if (existe) {
      // Se o pedido já existia para este mesmo orderId ou hoje, atualiza com os dados oficiais sem perder rota
      const novoStatus = (existe.status === 'em_rota' || existe.status === 'entregue') ? existe.status : 'disponivel';
      await db.execute(
        `UPDATE pedidos SET
           numero_pedido = ?,
           pedido_id_origem = ?,
           cliente = ?,
           endereco = ?,
           bairro = ?,
           taxa_entrega = ?,
           telefone_cliente = ?,
           localizador = ?,
           status = ?,
           criado_em = COALESCE(criado_em, DATETIME('now', '-3 hours')),
           texto_bruto = ?
         WHERE id = ?`,
        [numeroPedido, orderId, cliente, ruaCompleta, bairro, taxa, tel, loc, novoStatus, rawText, existe.id]
      );
      console.log(`🔄 [99Food] Pedido existente (ID ${existe.id}) atualizado com dados da API: #${numeroPedido} (${orderId}) [Status: ${novoStatus}]`);
      return;
    }

    // Inserção de NOVO pedido ativo para a cozinha
    await db.execute(
      `INSERT INTO pedidos 
       (numero_pedido, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, localizador, status, criado_em, texto_bruto)
       VALUES (?, '99FOOD', ?, ?, ?, ?, ?, ?, ?, 'disponivel', DATETIME('now', '-3 hours'), ?)`,
      [numeroPedido, orderId, cliente, ruaCompleta, bairro, taxa, tel, loc, rawText]
    );
    console.log(`✅ [99Food] Novo pedido inserido via API no painel: #${numeroPedido} (${orderId})`);
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
    // Apenas marca como entregue se NÃO estiver em rota com motoboy
    await db.execute(
      `UPDATE pedidos SET status = 'entregue', data_fim = COALESCE(data_fim, DATETIME('now', '-3 hours'))
       WHERE pedido_id_origem = ? AND origem = '99FOOD' AND status NOT IN ('em_rota', 'entregue')`,
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

    if (eventType === 'orderNew' || eventType === 'orderConfirm') {
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

async function checkStatus(req, res) {
  let shopsData = { total: 0, shop_list: [] };
  try {
    shopsData = await ninetyNineService.getAuthorizedShops();
  } catch (e) {
    shopsData = { total: 0, shop_list: [], error: e.message };
  }

  return res.json({
    ok: true,
    platform: '99Food / DiDi Food Open Platform',
    appId: env.FOOD99_APP_ID,
    shopId: env.FOOD99_SHOP_ID,
    appShopId: env.FOOD99_APP_SHOP_ID,
    webhookUrl: 'https://sist-homolog.vercel.app/api/99food/webhook',
    authorizedShops: shopsData,
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
