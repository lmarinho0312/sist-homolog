const ifoodService = require('../services/ifoodService');
const { getDb } = require('../database/db');
const { obterTaxaRepasse, obterNomeBairroCanonica } = require('../utils/rateResolver');
const memoryCache = require('../utils/memoryCache');

// Buffer em memória dos últimos 100 eventos recebidos do Webhook
const webhookEventsBuffer = [];

const fs = require('node:fs');
const CONFIG_FILE = '/tmp/homolog_config.json';

// Modo da Homologação:
// false = Modo Manual (o usuário clica para confirmar, despachar e cancelar)
// true = Modo Automático para o Robô (responde confirmação e cancelamento nos prazos do teste automático)
let autoMode = false;

function getStoredAutoMode() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (typeof data.autoMode === 'boolean') return data.autoMode;
    }
  } catch (e) {}
  return autoMode;
}

function setStoredAutoMode(val) {
  autoMode = val;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ autoMode: val }), 'utf8');
  } catch (e) {}
}

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
 * Persiste o evento na tabela ifood_events do banco SQLite local
 */
async function saveEventToDb(ev) {
  try {
    const db = getDb();
    const eventId = ev.id || `${ev.orderId}-${ev.code}-${Date.now()}`;
    await db.execute(
      `INSERT OR REPLACE INTO ifood_events (id, code, order_id, merchant_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        ev.code || ev.fullCode || 'UNKNOWN',
        ev.orderId || null,
        ev.merchantId || '',
        JSON.stringify(ev),
        ev.createdAt || new Date().toISOString()
      ]
    );
  } catch (err) {
    console.warn('⚠️ Erro ao persistir evento no SQLite:', err.message);
  }
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
      const code = ev.code || ev.fullCode;
      const orderId = ev.orderId;

      // Ignora heartbeats/keepalive para não poluir a tela do usuário
      if (!ev || code === 'KEEPALIVE' || !orderId) {
        continue;
      }

      recordEvent(ev);
      await saveEventToDb(ev);

      const isAuto = getStoredAutoMode();
      console.log(`🔔 [iFood Event] Código: ${code} | Pedido ID: ${orderId} | Modo Auto: ${isAuto}`);

      const isPlaced = code === 'PLACED' || code === 'PLC';
      const isConfirmed = code === 'CONFIRMED' || code === 'CFM';
      const isDispatched = code === 'DISPATCHED' || code === 'DSP';
      const isCancelRequested = code === 'CANCELLATION_REQUESTED' || code === 'ORDER_CANCELLATION_REQUESTED' || code === 'CPR' || code === 'CAR' || code === 'HANDSHAKE_DISPUTE';
      const isCancelled = code === 'CANCELLED' || code === 'CAN';

      if (isPlaced) {
        await processNewOrder(orderId);
        // Se o modo automático estiver ligado (para o robô do iFood homologar 100%):
        if (isAuto) {
          try {
            await ifoodService.confirmOrder(orderId);
            console.log(`🤖 [AutoMode] Pedido ${orderId} confirmado automaticamente para o robô de homologação!`);
            await updateOrderStatus(orderId, 'confirmado');
          } catch (errConfirm) {
            console.warn(`⚠️ [AutoMode] Falha ao auto-confirmar pedido ${orderId}: ${errConfirm.message}`);
          }
        }
      } else if (isConfirmed) {
        await processNewOrder(orderId);
        await updateOrderStatus(orderId, 'confirmado');
      } else if (isDispatched) {
        await updateOrderStatus(orderId, 'em_entrega');
      } else if (isCancelRequested) {
        console.log(`🔔 [iFood Cancel Request] Evento de cancelamento ${code} recebido para o pedido ${orderId}!`);
        await updateOrderStatus(orderId, 'cancelamento_solicitado');
        
        // Responde ao cancelamento exigido pela homologação oficial do iFood:
        // 1. Primeiro busca os motivos oficiais via GET /cancellationReasons
        // 2. Depois envia requestCancellation COM o motivo identificado
        // 3. Se requestCancellation falhar, tenta acceptCancellation como fallback
        try {
          // Passo 1: Consulta os motivos oficiais de cancelamento do pedido
          const reasons = await ifoodService.getCancellationReasons(orderId);
          const reasonCode = (reasons && reasons.length > 0) 
            ? String(reasons[0].code || reasons[0].cancelCodeId || '501') 
            : '501';
          const reasonDesc = (reasons && reasons.length > 0)
            ? (reasons[0].description || 'Problemas no sistema')
            : 'Problemas no sistema';
          
          console.log(`📋 [iFood Cancel] Motivos consultados para ${orderId}. Usando: ${reasonCode} - ${reasonDesc}`);
          console.log(`📋 [iFood Cancel] Lista completa de motivos:`, JSON.stringify(reasons));

          // Passo 2: Tenta solicitar cancelamento com o motivo oficial
          try {
            const cancelRes = await ifoodService.requestCancellation(orderId, reasonCode, reasonCode);
            console.log(`✅ [iFood Cancel] Cancelamento com motivo ${reasonCode} aceito para pedido ${orderId}:`, cancelRes);
            await updateOrderStatus(orderId, 'cancelado');
          } catch (errRequest) {
            console.warn(`⚠️ [iFood Cancel] requestCancellation falhou (${errRequest.message}), tentando acceptCancellation...`);
            
            // Passo 3: Fallback - tenta aceitar o cancelamento diretamente
            try {
              const acceptRes = await ifoodService.acceptCancellation(orderId);
              console.log(`✅ [iFood Cancel] Cancelamento aceito via acceptCancellation para pedido ${orderId}:`, acceptRes);
              await updateOrderStatus(orderId, 'cancelado');
            } catch (errAccept) {
              console.warn(`⚠️ [iFood Cancel] acceptCancellation também falhou: ${errAccept.message}`);
            }
          }
        } catch (errCancel) {
          console.error(`❌ [iFood Cancel] Erro completo ao processar cancelamento: ${errCancel.message}`);
        }
      } else if (isCancelled) {
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
  try {
    const db = getDb();
    let details = null;

    try {
      details = await ifoodService.getOrderDetails(orderId);
    } catch (e) {
      console.warn(`⚠️ [iFood processNewOrder] Não foi possível buscar detalhes da API do iFood para o pedido ${orderId}: ${e.message}`);
    }

    let merchantId = null;
    try {
      const evRow = await db.queryOne('SELECT merchant_id, payload FROM ifood_events WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
      if (evRow) merchantId = evRow.merchant_id;
    } catch(e) {}

    const LOJAS_IFOOD = {
      '851c6395-504f-44d9-b017-6c10cdfd3de1': 'Ao Ponto Comidas Brasileiras',
      '758a1a94-d7e3-46b0-83fc-a35e16a6eec5': 'Ao Ponto Burgers & Sanduíches',
      '517ac701-53b4-4bb4-a74c-ca0220533b87': 'Ao Ponto Carnes'
    };
    const nomeLoja = LOJAS_IFOOD[merchantId] || 'Ao Ponto iFood';

    const numeroCurto = (orderId && orderId.length >= 4) ? orderId.slice(-4).toUpperCase() : 'IFOOD';
    const numeroExibicao = details?.displayId ? String(details.displayId) : numeroCurto;
    const clienteNome = details?.customer?.name || `Cliente iFood (${nomeLoja})`;
    const clienteTel = details?.customer?.phone?.number || null;
    const enderecoEntrega = details?.delivery?.deliveryAddress;
    
    const rua = enderecoEntrega?.streetName 
      ? `${enderecoEntrega.streetName}, ${enderecoEntrega.streetNumber || 'S/N'}${enderecoEntrega.complement ? ' ' + enderecoEntrega.complement : ''}` 
      : 'Endereço registrado no Gestor iFood';
    const bairroBruto = enderecoEntrega?.neighborhood || 'Várzea';
    const bairroCanonica = obterNomeBairroCanonica(bairroBruto, rua) || bairroBruto || 'Várzea';
    const taxaEntrega = obterTaxaRepasse(bairroCanonica, 'VELOZ') || 10.0;

    // Mecanismo rigoroso anti-duplicação: verifica tanto por pedido_id_origem (UUID) quanto por numero_pedido (#8639)
    const existente = await db.queryOne(
      `SELECT id, status, cliente, endereco FROM pedidos 
       WHERE (pedido_id_origem = ? OR numero_pedido = ?) AND origem = 'IFOOD'`,
      [orderId, numeroExibicao]
    );

    if (existente) {
      console.log(`ℹ️ [iFood] Pedido #${numeroExibicao} (${orderId}) já existe na base (ID ${existente.id}). Atualizando dados cadastrais.`);
      await db.execute(
        `UPDATE pedidos 
         SET pedido_id_origem = ?, cliente = ?, endereco = ?, bairro = ?, taxa_entrega = ?, telefone_cliente = ?, texto_bruto = ?
         WHERE id = ?`,
        [
          orderId,
          clienteNome,
          rua,
          bairroCanonica,
          taxaEntrega,
          clienteTel,
          JSON.stringify(details || { orderId, merchantId, nomeLoja, via: 'ifood_api_webhook', data: new Date().toISOString() }),
          existente.id
        ]
      );
    } else {
      await db.execute(
        `INSERT INTO pedidos 
         (numero_pedido, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, status, texto_bruto, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'disponivel', ?, DATETIME('now', '-3 hours'))`,
        [
          numeroExibicao,
          'IFOOD',
          orderId,
          clienteNome,
          rua,
          bairroCanonica,
          taxaEntrega,
          clienteTel,
          JSON.stringify(details || { orderId, merchantId, nomeLoja, via: 'ifood_api_webhook', data: new Date().toISOString() })
        ]
      );
      console.log(`✅ [iFood] Pedido #${numeroExibicao} (${orderId}) inserido com sucesso na base de entregas!`);
    }
    memoryCache.clear();
  } catch (err) {
    console.warn('⚠️ Erro ao registrar pedido iFood:', err.message);
  }
}

/**
 * Atualiza status local do pedido
 */
async function updateOrderStatus(orderId, novoStatus) {
  try {
    const db = getDb();
    await db.execute(
      'UPDATE pedidos SET status = ? WHERE pedido_id_origem = ? AND origem = ?',
      [novoStatus, orderId, 'IFOOD']
    );
    memoryCache.clear();
  } catch (err) {
    console.warn('⚠️ Aviso ao atualizar status local do pedido no SQLite:', err.message);
  }
}

/**
 * Retorna os últimos eventos de webhook recebidos (mesclando banco e memória)
 * GET /api/ifood/events
 */
async function listRecentEvents(req, res) {
  let dbEvents = [];
  try {
    const db = getDb();
    const rows = await db.query('SELECT * FROM ifood_events ORDER BY created_at DESC LIMIT 50');
    dbEvents = (rows || []).map(r => ({
      id: r.id,
      code: r.code,
      orderId: r.order_id,
      merchantId: r.merchant_id,
      receivedAt: r.created_at,
      data: r.payload ? JSON.parse(r.payload) : {}
    }));
  } catch (e) {
    // Silencioso se o banco estiver indisponível
  }

  // Mescla eventos do banco com o buffer em memória (sem duplicatas e sem KEEPALIVE)
  const map = new Map();
  for (const ev of [...webhookEventsBuffer, ...dbEvents]) {
    if (ev && ev.orderId && ev.orderId !== 'undefined' && ev.code !== 'KEEPALIVE') {
      const key = ev.id || `${ev.orderId}-${ev.code}`;
      if (!map.has(key)) {
        map.set(key, ev);
      }
    }
  }

  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0)
  );

  return res.json({
    total: merged.length,
    autoMode: getStoredAutoMode(),
    events: merged
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
  const { orderId, reason, cancellationCode, actionType } = req.body || {};
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
      result = await ifoodService.requestCancellation(orderId, reason || '501', cancellationCode || '501');
    }
    await updateOrderStatus(orderId, 'cancelado');
    return res.json(result);
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

/**
 * Configurações da homologação (Alternar entre Modo Manual e Automático)
 * GET /api/ifood/config
 * POST /api/ifood/config
 */
function getConfig(req, res) {
  return res.json({ autoMode: getStoredAutoMode() });
}

function setConfig(req, res) {
  if (typeof req.body?.autoMode === 'boolean') {
    setStoredAutoMode(req.body.autoMode);
    console.log(`🔄 [Homologação] Modo alterado para: ${req.body.autoMode ? 'AUTOMÁTICO' : 'MANUAL'}`);
  }
  return res.json({ success: true, autoMode: getStoredAutoMode() });
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
  await saveEventToDb(fakeEvent);
  return res.json({ success: true, simulated: fakeEvent });
}

/**
 * Consulta motivos válidos de cancelamento para um pedido
 * GET /api/ifood/orders/reasons
 */
async function getCancellationReasonsAction(req, res) {
  const orderId = req.query?.orderId;
  try {
    const reasons = await ifoodService.getCancellationReasons(orderId);
    return res.json(reasons);
  } catch (error) {
    return res.json(500, { error: error.message });
  }
}

module.exports = {
  checkStatus,
  handleWebhook,
  listRecentEvents,
  confirmOrderAction,
  dispatchOrderAction,
  cancelOrderAction,
  getCancellationReasonsAction,
  simulateEvent,
  pingPresenceAction,
  getConfig,
  setConfig
};
