const env = require('../config/env');
const cardapioWebService = require('../services/cardapioWebService');
const { getDb } = require('../database/db');
const { obterTaxaRepasse, obterNomeBairroCanonica } = require('../utils/rateResolver');
const memoryCache = require('../utils/memoryCache');

// Buffer em memória dos últimos 100 eventos recebidos (zero custo de leitura/escrita no Turso)
const recentEvents = [];

/**
 * Calcula o timestamp inicial do turno operacional atual ('YYYY-MM-DD 02:00:00') no fuso de Brasília.
 * Permite uso direto de índice B-Tree (criado_em >= ?) com consumo mínimo de reads no Turso.
 */
function obterInicioTurnoAtual() {
  const turnoDate = new Date(Date.now() - (3 * 3600000) - (2 * 3600000));
  return `${turnoDate.toISOString().slice(0, 10)} 02:00:00`;
}

function recordEvent(ev) {
  const item = {
    ...ev,
    receivedAt: new Date().toISOString()
  };
  recentEvents.unshift(item);
  if (recentEvents.length > 100) {
    recentEvents.pop();
  }
  return item;
}

/**
 * Busca os detalhes completos do pedido na API do CardápioWeb com até 3 tentativas (backoff curto)
 */
async function fetchOrderDetailsWithRetry(orderId, maxRetries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const details = await cardapioWebService.getOrderDetails(orderId);
      if (details && (details.id || details.display_id)) {
        return details;
      }
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ [CardápioWeb API] Tentativa ${attempt}/${maxRetries} ao buscar pedido ${orderId}: ${err.message}`);
    }
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, attempt * 350));
    }
  }
  if (lastError) {
    console.error(`❌ [CardápioWeb API] Falha após ${maxRetries} tentativas para o pedido ${orderId}: ${lastError.message}`);
  }
  return null;
}

/**
 * Processa e registra (ou atualiza) um pedido de delivery do CardápioWeb no banco de dados.
 * Idempotente e otimizado para consumo mínimo de reads no Turso.
 */
async function processOrder(orderId, inlineOrderDetails = null) {
  if (!orderId) return null;
  const orderIdStr = String(orderId).trim();

  try {
    const db = getDb();

    // 1. Consulta indexada por origem + pedido_id_origem (1 read no Turso)
    let existente = await db.queryOne(
      `SELECT id, numero_pedido, status, cliente, endereco, motoboy_id
       FROM pedidos
       WHERE origem = 'CARDAPIO_WEB' AND pedido_id_origem = ?
       LIMIT 1`,
      [orderIdStr]
    );

    // Curto-circuito de economia máxima: se o pedido já está registrado e com dados completos do cliente,
    // não repetimos chamada HTTP externa nem escrita no banco!
    const temDadosCompletos = existente
      && existente.cliente
      && !existente.cliente.startsWith('Cliente Cardápio')
      && existente.endereco
      && existente.endereco !== 'Endereço CardápioWeb';

    if (temDadosCompletos) {
      return existente;
    }

    // 2. Obtém os detalhes completos do pedido (do payload inline caso já venha completo, ou via API CardápioWeb)
    const hasInlineAddressOrType = inlineOrderDetails
      && inlineOrderDetails.order_type
      && (inlineOrderDetails.delivery_address || inlineOrderDetails.customer);

    const details = hasInlineAddressOrType
      ? inlineOrderDetails
      : await fetchOrderDetailsWithRetry(orderIdStr, 3);

    if (!details) {
      console.warn(`⚠️ [CardápioWeb] Não foi possível obter os detalhes do pedido ${orderIdStr}.`);
      return existente || null;
    }

    // 3. Filtra pedidos que NÃO são de entrega (ex: takeout / retirada no balcão, onsite / mesa)
    const orderType = String(details.order_type || '').toLowerCase().trim();
    if (orderType && orderType !== 'delivery') {
      console.log(`ℹ️ [CardápioWeb] Pedido #${details.display_id || orderIdStr} (${orderIdStr}) é "${orderType}" (sem entrega por motoboy). Ignorado.`);
      return null;
    }

    // Se o pedido já nasceu cancelado na API, não injeta como disponível
    const apiStatus = String(details.status || '').toLowerCase().trim();
    if (apiStatus === 'canceled' || apiStatus === 'cancelled') {
      console.log(`ℹ️ [CardápioWeb] Pedido #${details.display_id || orderIdStr} já consta como cancelado. Ignorado.`);
      return null;
    }

    // 4. Extração de número de exibição, cliente, telefone, endereço, bairro e taxa
    const numeroExibicao = details.display_id
      ? String(details.display_id).trim()
      : (details.external_display_id ? String(details.external_display_id).trim() : orderIdStr);

    const clienteNome = details.customer?.name
      ? String(details.customer.name).trim()
      : 'Cliente CardápioWeb';

    const clienteTel = details.customer?.phone
      ? String(details.customer.phone).replace(/\D/g, '')
      : null;

    const localizador = details.public_id ? String(details.public_id).trim() : null;

    const addr = details.delivery_address || {};
    const street = String(addr.street || '').trim();
    const number = String(addr.number || 'S/N').trim();
    const complement = String(addr.complement || '').trim();
    const reference = String(addr.reference || '').trim();

    let rua = street ? `${street}, ${number}` : 'Endereço CardápioWeb';
    if (complement) {
      rua += ` - ${complement}`;
    }
    if (reference && reference.toLowerCase() !== complement.toLowerCase()) {
      rua += ` (Ref: ${reference})`;
    }

    const bairroBruto = String(addr.neighborhood || '').trim() || 'Várzea';
    const bairroCanonica = obterNomeBairroCanonica(bairroBruto, rua) || bairroBruto || 'Várzea';
    const taxaEntrega = obterTaxaRepasse(bairroCanonica, rua, '', 'VELOZ') || 10.0;
    const textoBrutoPayload = JSON.stringify(details);

    // 5. Caso não tenha encontrado pelo ID interno do CardápioWeb, verifica no turno atual pelo display_id
    // (evita duplicação caso o spooler térmico tenha registrado a comanda segundos antes)
    if (!existente && numeroExibicao) {
      const inicioTurno = obterInicioTurnoAtual();
      existente = await db.queryOne(
        `SELECT id, numero_pedido, status, cliente, endereco, motoboy_id
         FROM pedidos
         WHERE origem = 'CARDAPIO_WEB'
           AND numero_pedido = ?
           AND criado_em >= ?
         LIMIT 1`,
        [numeroExibicao, inicioTurno]
      );
    }

    if (existente) {
      const statusPreservado = (existente.status === 'em_rota' || existente.status === 'entregue' || existente.status === 'cancelado')
        ? existente.status
        : 'disponivel';

      await db.execute(
        `UPDATE pedidos
         SET numero_pedido = ?, pedido_id_origem = ?, cliente = ?, endereco = ?, bairro = ?, taxa_entrega = ?, telefone_cliente = ?, localizador = ?, status = ?, texto_bruto = ?
         WHERE id = ?`,
        [
          numeroExibicao,
          orderIdStr,
          clienteNome,
          rua,
          bairroCanonica,
          taxaEntrega,
          clienteTel,
          localizador,
          statusPreservado,
          textoBrutoPayload,
          existente.id
        ]
      );
      console.log(`✅ [CardápioWeb] Pedido #${numeroExibicao} (${orderIdStr}) atualizado na base (ID ${existente.id}).`);
    } else {
      await db.execute(
        `INSERT INTO pedidos
         (numero_pedido, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, localizador, status, texto_bruto, criado_em)
         VALUES (?, 'CARDAPIO_WEB', ?, ?, ?, ?, ?, ?, ?, 'disponivel', ?, DATETIME('now', '-3 hours'))`,
        [
          numeroExibicao,
          orderIdStr,
          clienteNome,
          rua,
          bairroCanonica,
          taxaEntrega,
          clienteTel,
          localizador,
          textoBrutoPayload
        ]
      );
      console.log(`✅ [CardápioWeb] Novo pedido #${numeroExibicao} (${orderIdStr}) inserido no balcão! Bairro: ${bairroCanonica} | Taxa: R$ ${taxaEntrega}`);
    }

    memoryCache.clear();
    return { numero_pedido: numeroExibicao, pedido_id_origem: orderIdStr };
  } catch (err) {
    console.error(`❌ [CardápioWeb] Erro ao processar pedido ${orderIdStr}:`, err.message);
    return null;
  }
}

/**
 * Cancela um pedido do CardápioWeb no banco local quando cancelado na plataforma
 */
async function cancelOrderInDb(orderId) {
  if (!orderId) return;
  try {
    const db = getDb();
    await db.execute(
      `UPDATE pedidos
       SET status = 'cancelado', data_fim = COALESCE(data_fim, DATETIME('now', '-3 hours'))
       WHERE origem = 'CARDAPIO_WEB' AND pedido_id_origem = ? AND status != 'entregue'`,
      [String(orderId).trim()]
    );
    memoryCache.clear();
    console.log(`🚫 [CardápioWeb] Pedido (${orderId}) marcado como cancelado.`);
  } catch (err) {
    console.warn(`⚠️ [CardápioWeb] Erro ao cancelar pedido ${orderId} no banco:`, err.message);
  }
}

/**
 * Receptor Oficial de Webhook do CardápioWeb
 * GET / HEAD / POST /api/cardapioweb/webhook
 */
async function handleWebhook(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.json(200, {
      status: 'UP',
      service: 'cardapioweb-partner-webhook',
      store_id: env.CARDAPIOWEB_STORE_ID || '24175',
      timestamp: new Date().toISOString()
    });
  }

  // Se o usuário tiver configurado um CARDAPIOWEB_WEBHOOK_TOKEN explícito no ambiente, valida o header X-Webhook-Token
  if (env.CARDAPIOWEB_WEBHOOK_TOKEN) {
    const incomingToken = req.headers['x-webhook-token'] || req.headers['X-Webhook-Token'] || '';
    if (incomingToken && incomingToken !== env.CARDAPIOWEB_WEBHOOK_TOKEN) {
      console.warn('⚠️ [CardápioWeb Webhook] X-Webhook-Token divergente.');
      return res.json(401, { status: 'error', message: 'Unauthorized X-Webhook-Token' });
    }
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  const events = Array.isArray(body) ? body : [body];
  console.log(`📥 [CardápioWeb Webhook] Recebidos ${events.length} evento(s) às ${new Date().toISOString()}`);

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;

    const eventType = String(ev.event_type || ev.type || (ev.id && ev.order_type ? 'ORDER_DIRECT' : 'UNKNOWN')).toUpperCase();
    const orderId = ev.order_id || ev.orderId || ev.id || ev.data?.order_id || ev.data?.id;
    const orderStatus = String(ev.order_status || ev.status || ev.data?.status || '').toLowerCase().trim();
    const merchantId = ev.merchant_id || ev.merchantId || env.CARDAPIOWEB_STORE_ID;

    recordEvent({
      event_id: ev.event_id || `cw-${Date.now()}`,
      event_type: eventType,
      merchant_id: merchantId,
      order_id: orderId ? String(orderId) : null,
      order_status: orderStatus || null,
      raw: ev
    });

    if (!orderId) {
      continue;
    }

    console.log(`🔔 [CardápioWeb Event] Tipo: ${eventType} | Pedido ID: ${orderId} | Status: ${orderStatus || 'N/A'}`);

    const isCanceled = eventType.includes('CANCEL')
      || orderStatus === 'canceled'
      || orderStatus === 'cancelled';

    if (isCanceled) {
      await cancelOrderInDb(orderId);
      continue;
    }

    // Se o pedido foi fechado/concluído no painel do CardápioWeb, não criamos um pedido novo;
    // se já existir no balcão ou em rota, deixamos o motoboy finalizar normalmente no app
    const isClosedOnly = orderStatus === 'closed' || orderStatus === 'delivered' || orderStatus === 'finalized';
    if (isClosedOnly && eventType !== 'ORDER_CREATED' && eventType !== 'ORDER_DIRECT') {
      console.log(`ℹ️ [CardápioWeb] Evento de fechamento (${orderStatus}) para pedido ${orderId} registrado.`);
      continue;
    }

    // Para ORDER_CREATED ou qualquer atualização ativa de pedido (waiting_confirmation, confirmed, ready, released, etc.)
    const inlineOrder = (ev.id && ev.order_type) ? ev : null;
    await processOrder(orderId, inlineOrder);
  }

  return res.json(200, { status: 'ok', received: events.length });
}

/**
 * Verifica conectividade e dados da loja no CardápioWeb
 * GET /api/cardapioweb/status
 */
async function checkStatus(req, res) {
  try {
    const merchant = await cardapioWebService.getMerchantInfo();
    return res.json(200, {
      ok: true,
      service: 'CardápioWeb Partner API v1',
      store_id: env.CARDAPIOWEB_STORE_ID,
      merchant: merchant ? {
        id: merchant.id,
        name: merchant.name,
        slug: merchant.slug,
        status: merchant.status,
        operation_modes: merchant.operation_modes
      } : null,
      webhook_url: 'https://sist-homolog-iota.vercel.app/api/cardapioweb/webhook',
      recent_events_count: recentEvents.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.json(500, {
      ok: false,
      service: 'CardápioWeb Partner API v1',
      store_id: env.CARDAPIOWEB_STORE_ID,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Lista os últimos eventos recebidos no Webhook do CardápioWeb (em memória)
 * GET /api/cardapioweb/events
 */
async function listRecentEvents(req, res) {
  return res.json(200, {
    ok: true,
    total: recentEvents.length,
    events: recentEvents
  });
}

/**
 * Consulta detalhes de um pedido diretamente na API do CardápioWeb
 * GET /api/cardapioweb/orders/details?order_id=...
 */
async function getOrderDetailsAction(req, res) {
  try {
    const orderId = req.query?.order_id || req.query?.id;
    if (!orderId) {
      return res.json(400, { ok: false, message: 'Parâmetro order_id é obrigatório.' });
    }
    const details = await cardapioWebService.getOrderDetails(orderId);
    return res.json(200, { ok: true, order: details });
  } catch (error) {
    return res.json(500, { ok: false, error: error.message });
  }
}

/**
 * Ações de transição de status no CardápioWeb (confirm, ready, delivered, finalize, cancel)
 */
async function confirmOrderAction(req, res) {
  try {
    const { order_id, orderId } = req.body || {};
    const id = order_id || orderId;
    if (!id) return res.json(400, { ok: false, message: 'order_id é obrigatório.' });
    const data = await cardapioWebService.confirmOrder(id);
    return res.json(200, { ok: true, data });
  } catch (error) {
    return res.json(500, { ok: false, error: error.message });
  }
}

async function readyOrderAction(req, res) {
  try {
    const { order_id, orderId } = req.body || {};
    const id = order_id || orderId;
    if (!id) return res.json(400, { ok: false, message: 'order_id é obrigatório.' });
    const data = await cardapioWebService.readyOrder(id);
    return res.json(200, { ok: true, data });
  } catch (error) {
    return res.json(500, { ok: false, error: error.message });
  }
}

async function finalizeOrderAction(req, res) {
  try {
    const { order_id, orderId } = req.body || {};
    const id = order_id || orderId;
    if (!id) return res.json(400, { ok: false, message: 'order_id é obrigatório.' });
    const data = await cardapioWebService.finalizeOrder(id);
    return res.json(200, { ok: true, data });
  } catch (error) {
    return res.json(500, { ok: false, error: error.message });
  }
}

async function cancelOrderAction(req, res) {
  try {
    const { order_id, orderId, reason } = req.body || {};
    const id = order_id || orderId;
    if (!id) return res.json(400, { ok: false, message: 'order_id é obrigatório.' });
    const data = await cardapioWebService.cancelOrder(id, reason);
    await cancelOrderInDb(id);
    return res.json(200, { ok: true, data });
  } catch (error) {
    return res.json(500, { ok: false, error: error.message });
  }
}

module.exports = {
  handleWebhook,
  checkStatus,
  listRecentEvents,
  getOrderDetailsAction,
  confirmOrderAction,
  readyOrderAction,
  finalizeOrderAction,
  cancelOrderAction,
  processOrder
};
