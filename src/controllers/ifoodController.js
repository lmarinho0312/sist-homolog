const ifoodService = require('../services/ifoodService');
const { getDb } = require('../database/db');
const { obterTaxaRepasse, obterNomeBairroCanonica } = require('../utils/rateResolver');

// Buffer em memória dos últimos 100 eventos recebidos do Webhook
const webhookEventsBuffer = [];

/**
 * Registra um evento no buffer de depuração
 */
function recordEvent(event) {
  const item = {
    ...event,
    receivedAt: new Date().toISOString()
  };
  webhookEventsBuffer.unshift(item);
  if (webhookEventsBuffer.length > 100) {
    webhookEventsBuffer.pop();
  }
  return item;
}

/**
 * Etapa 1 - Verifica a Conectividade OAuth2 e Status da Loja
 * GET /api/ifood/status
 */
async function checkStatus(req, res) {
  try {
    const result = await ifoodService.testConnectivity();
    return res.json(result);
  } catch (error) {
    return res.json(500, {
      ok: false,
      etapa: 1,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Webhook Receptor do iFood
 * POST /api/ifood/webhook
 * 
 * iFood envia eventos como PLACED, CONFIRMED, DISPATCHED, CANCELLED, etc.
 * Responde 200 imediatamente para o iFood e processa de forma assíncrona.
 */
async function handleWebhook(req, res) {
  const body = req.body || [];
  const events = Array.isArray(body) ? body : [body];

  console.log(`📥 [iFood Webhook] Recebidos ${events.length} evento(s) às ${new Date().toISOString()}`);

  // Responde imediatamente com 200 OK para satisfazer o SLA do iFood (< 3s)
  res.json({ status: 'ok', received: events.length });

  // Processamento assíncrono dos eventos
  for (const ev of events) {
    try {
      recordEvent(ev);
      const { code, orderId } = ev;
      console.log(`🔔 [iFood Event] Código: ${code} | Pedido ID: ${orderId}`);

      if (!orderId) continue;

      if (code === 'PLACED') {
        // Novo pedido realizado no iFood
        await processNewOrder(orderId);
        // Etapa 2 - Confirma o pedido automaticamente (CFM) para validar a homologação
        try {
          await ifoodService.confirmOrder(orderId);
          console.log(`✅ [Auto-Confirm] Pedido ${orderId} confirmado automaticamente no iFood (CFM)!`);
          await updateOrderStatus(orderId, 'confirmado');
        } catch (errConfirm) {
          console.warn(`⚠️ Auto-confirmação do pedido ${orderId}: ${errConfirm.message}`);
        }
      } else if (code === 'CONFIRMED') {
        await updateOrderStatus(orderId, 'confirmado');
      } else if (code === 'DISPATCHED') {
        await updateOrderStatus(orderId, 'em_entrega');
      } else if (code === 'CANCELLED' || code === 'ORDER_CANCELLATION_REQUESTED') {
        await updateOrderStatus(orderId, 'cancelado');
      }
    } catch (err) {
      console.error(`❌ Erro ao processar evento ${ev.code || 'UNKNOWN'} (${ev.orderId}):`, err.message);
    }
  }
}

/**
 * Processa um pedido recém-chegado (PLACED)
 * Busca os detalhes via API e salva na base local
 */
async function processNewOrder(orderId) {
  const db = getDb();
  let details = null;

  try {
    details = await ifoodService.getOrderDetails(orderId);
  } catch (e) {
    console.warn(`⚠️ Não foi possível buscar detalhes da API do iFood para o pedido ${orderId}: ${e.message}`);
  }

  const numeroExibicao = details?.displayId || orderId.substring(0, 8);
  const clienteNome = details?.customer?.name || 'Cliente iFood';
  const clienteTel = details?.customer?.phone?.number || null;
  const enderecoEntrega = details?.delivery?.deliveryAddress;
  
  const rua = enderecoEntrega?.streetName ? `${enderecoEntrega.streetName}, ${enderecoEntrega.streetNumber || 'S/N'}` : 'Endereço não informado';
  const bairroBruto = enderecoEntrega?.neighborhood || 'Centro';
  const bairroCanonica = obterNomeBairroCanonica(bairroBruto) || bairroBruto;
  const taxaEntrega = obterTaxaRepasse(bairroCanonica, 'VELOZ');

  // Verifica se já existe na base
  const existente = await db.queryOne(
    'SELECT id FROM pedidos WHERE pedido_id_origem = ? AND origem = ?',
    [orderId, 'IFOOD']
  );

  if (!existente) {
    await db.execute(
      `INSERT INTO pedidos 
       (numero_pedido, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, status, texto_bruto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'disponivel', ?)`,
      [
        numeroExibicao,
        'IFOOD',
        orderId,
        clienteNome,
        rua,
        bairroCanonica,
        taxaEntrega,
        clienteTel,
        JSON.stringify(details || { orderId })
      ]
    );
    console.log(`✅ [iFood] Pedido #${numeroExibicao} (${orderId}) inserido no banco de dados local!`);
  }
}

/**
 * Atualiza status local do pedido
 */
async function updateOrderStatus(orderId, novoStatus) {
  const db = getDb();
  await db.execute(
    'UPDATE pedidos SET status = ? WHERE pedido_id_origem = ? AND origem = ?',
    [novoStatus, orderId, 'IFOOD']
  );
}

/**
 * Retorna os últimos eventos de webhook recebidos (para o painel de homologação)
 * GET /api/ifood/events
 */
async function listRecentEvents(req, res) {
  return res.json({
    total: webhookEventsBuffer.length,
    events: webhookEventsBuffer
  });
}

/**
 * Ação manual ou programada: Confirma um pedido (Etapa 2)
 * POST /api/ifood/orders/confirm
 */
async function confirmOrderAction(req, res) {
  const orderId = req.body?.orderId || req.query?.orderId;
  if (!orderId) {
    return res.json(400, { error: 'orderId é obrigatório' });
  }

  try {
    const result = await ifoodService.confirmOrder(orderId);
    await updateOrderStatus(orderId, 'confirmado');
    return res.json(result);
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Ação manual ou programada: Despacha um pedido (Etapa 4)
 * POST /api/ifood/orders/dispatch
 */
async function dispatchOrderAction(req, res) {
  const orderId = req.body?.orderId || req.query?.orderId;
  if (!orderId) {
    return res.json(400, { error: 'orderId é obrigatório' });
  }

  try {
    const result = await ifoodService.dispatchOrder(orderId);
    await updateOrderStatus(orderId, 'em_entrega');
    return res.json(result);
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Ação manual ou programada: Cancela um pedido (Etapa 3)
 * POST /api/ifood/orders/cancel
 */
async function cancelOrderAction(req, res) {
  const { orderId, reason, actionType } = req.body || {};
  if (!orderId) {
    return res.json(400, { error: 'orderId é obrigatório' });
  }

  try {
    let result;
    if (actionType === 'accept') {
      result = await ifoodService.acceptCancellation(orderId);
    } else if (actionType === 'deny') {
      result = await ifoodService.denyCancellation(orderId, reason || 'Pedido em entrega');
    } else {
      result = await ifoodService.requestCancellation(orderId, reason || 'PROBLEMAS_OPERACIONAIS', '501');
    }
    await updateOrderStatus(orderId, 'cancelado');
    return res.json(result);
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Simula um evento de Webhook para testes de interface e fluxo
 * POST /api/ifood/simulate
 */
async function simulateEvent(req, res) {
  const { code, orderId } = req.body || {};
  const fakeEvent = {
    id: 'sim-' + Date.now(),
    code: code || 'PLACED',
    orderId: orderId || ('test-' + Math.floor(1000 + Math.random() * 9000)),
    merchantId: 'merchant-test',
    createdAt: new Date().toISOString()
  };

  recordEvent(fakeEvent);
  return res.json({ success: true, simulated: fakeEvent });
}

/**
 * Mantém a loja ONLINE no iFood enviando keepalive/polling
 * GET ou POST /api/ifood/ping
 */
async function pingPresenceAction(req, res) {
  try {
    const result = await ifoodService.pingPresence();
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      store: 'ONLINE',
      result
    });
  } catch (error) {
    return res.json(500, {
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  checkStatus,
  handleWebhook,
  listRecentEvents,
  confirmOrderAction,
  dispatchOrderAction,
  cancelOrderAction,
  simulateEvent,
  pingPresenceAction
};
