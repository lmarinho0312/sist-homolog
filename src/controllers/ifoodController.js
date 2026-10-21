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
 * Calcula o timestamp inicial do turno operacional atual ('YYYY-MM-DD 02:00:00') no fuso de Brasília.
 * Permite uso direto de índice B-Tree (criado_em >= ?) com consumo mínimo de reads no Turso.
 */
function obterInicioTurnoAtual() {
  const turnoDate = new Date(Date.now() - (3 * 3600000) - (2 * 3600000));
  return `${turnoDate.toISOString().slice(0, 10)} 02:00:00`;
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
 * Persiste o evento na tabela ifood_events do banco SQLite/Turso
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
    memoryCache.del('ifood_recent_events');
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
 * Busca os detalhes do pedido na API do iFood com retentativas automáticas (backoff curto)
 * para contornar atrasos de indexação da API do iFood nos primeiros milissegundos do pedido.
 */
async function fetchOrderDetailsWithRetry(orderId, maxRetries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const details = await ifoodService.getOrderDetails(orderId);
      if (details && (details.id || details.displayId || details.customer)) {
        return details;
      }
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ [iFood API] Tentativa ${attempt}/${maxRetries} ao buscar pedido ${orderId}: ${err.message}`);
    }
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, attempt * 400));
    }
  }
  if (lastError) {
    console.error(`❌ [iFood API] Falha após ${maxRetries} tentativas para o pedido ${orderId}: ${lastError.message}`);
  }
  return null;
}

/**
 * Webhook Receptor do iFood
 * POST /api/ifood/webhook
 * 
 * Aguarda o processamento completo antes de responder 200 OK para evitar que o runtime
 * Serverless da Vercel congele a execução antes de gravar o pedido no banco.
 */
async function handleWebhook(req, res) {
  const body = req.body || [];
  const events = Array.isArray(body) ? body : [body];

  console.log(`📥 [iFood Webhook] Recebidos ${events.length} evento(s) às ${new Date().toISOString()}`);

  for (const ev of events) {
    try {
      const code = ev.code || ev.fullCode;
      const orderId = ev.orderId;
      const merchantId = ev.merchantId || '';

      // Ignora heartbeats/keepalive
      if (!ev || code === 'KEEPALIVE' || !orderId) {
        continue;
      }

      recordEvent(ev);
      await saveEventToDb(ev);

      const isAuto = getStoredAutoMode();
      console.log(`🔔 [iFood Event] Código: ${code} | Pedido ID: ${orderId} | Modo Auto: ${isAuto}`);

      const isPlaced = code === 'PLACED' || code === 'PLC';
      const isConfirmed = code === 'CONFIRMED' || code === 'CFM';
      const isActiveLifecycle = code === 'PREPARATION_STARTED' || code === 'PRS' || code === 'READY_TO_PICKUP' || code === 'RTP' || code === 'DISPATCHED' || code === 'DSP';
      const isCancelRequested = code === 'CANCELLATION_REQUESTED' || code === 'ORDER_CANCELLATION_REQUESTED' || code === 'CPR' || code === 'CAR' || code === 'HANDSHAKE_DISPUTE';
      const isCancelled = code === 'CANCELLED' || code === 'CAN';

      if (isPlaced) {
        await processNewOrder(orderId, merchantId);
        if (isAuto) {
          try {
            await ifoodService.confirmOrder(orderId);
            console.log(`🤖 [AutoMode] Pedido ${orderId} confirmado no iFood.`);
          } catch (errConfirm) {
            console.warn(`⚠️ [AutoMode] Falha ao auto-confirmar pedido ${orderId}: ${errConfirm.message}`);
          }
        }
      } else if (isConfirmed || isActiveLifecycle) {
        // Garante que o pedido exista na base e que seus dados cadastrais estejam completos
        await processNewOrder(orderId, merchantId);
      } else if (isCancelRequested) {
        console.log(`🔔 [iFood Cancel Request] Evento de cancelamento ${code} recebido para o pedido ${orderId}!`);
        await updateOrderStatus(orderId, 'cancelamento_solicitado');
        
        try {
          const reasons = await ifoodService.getCancellationReasons(orderId);
          const reasonCode = (reasons && reasons.length > 0) 
            ? String(reasons[0].code || reasons[0].cancelCodeId || '501') 
            : '501';
          const reasonDesc = (reasons && reasons.length > 0)
            ? (reasons[0].description || 'Problemas no sistema')
            : 'Problemas no sistema';
          
          console.log(`📋 [iFood Cancel] Motivos consultados para ${orderId}. Usando: ${reasonCode} - ${reasonDesc}`);

          try {
            const cancelRes = await ifoodService.requestCancellation(orderId, reasonCode, reasonCode);
            console.log(`✅ [iFood Cancel] Cancelamento com motivo ${reasonCode} aceito para pedido ${orderId}:`, cancelRes);
            await updateOrderStatus(orderId, 'cancelado');
          } catch (errRequest) {
            console.warn(`⚠️ [iFood Cancel] requestCancellation falhou (${errRequest.message}), tentando acceptCancellation...`);
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
      console.error(`❌ Erro ao processar evento ${ev?.code || 'UNKNOWN'} (${ev?.orderId}):`, err.message);
    }
  }

  return res.json({ status: 'ok', received: events.length });
}

/**
 * Processa um pedido do iFood de forma idempotente, resiliente e com mínimo consumo de reads no Turso.
 */
async function processNewOrder(orderId, eventMerchantId = '') {
  if (!orderId) return null;

  try {
    const db = getDb();

    // 1. Busca indexada pelo índice único idx_pedidos_ifood_unique_origem (custo: 1 read no Turso)
    let existente = await db.queryOne(
      `SELECT id, numero_pedido, status, cliente, endereco, motoboy_id 
       FROM pedidos 
       WHERE origem = 'IFOOD' AND pedido_id_origem = ? 
       LIMIT 1`,
      [orderId]
    );

    // Curto-circuito de economia máxima: se o pedido já existe e já tem nome e endereço reais do cliente,
    // não fazemos chamada externa à API do iFood nem escrita redundante no banco!
    const temDadosCompletos = existente
      && existente.cliente
      && !existente.cliente.startsWith('Cliente iFood')
      && existente.endereco
      && existente.endereco !== 'Endereço registrado no Gestor iFood';

    if (temDadosCompletos) {
      return existente;
    }

    // 2. Busca detalhes completos na API do iFood com até 3 tentativas
    const details = await fetchOrderDetailsWithRetry(orderId, 3);

    // Se for pedido de RETIRADA no balcão pelo cliente (TAKEOUT), não deve ir para os motoboys
    const orderType = String(details?.orderType || details?.delivery?.mode || '').toUpperCase();
    if (orderType === 'TAKEOUT' || orderType === 'INDOOR') {
      console.log(`ℹ️ [iFood API] Pedido ${orderId} é ${orderType} (Retirada pelo cliente). Ignorado para entrega.`);
      return null;
    }

    const merchantId = details?.merchant?.id || eventMerchantId || '';
    const LOJAS_IFOOD = {
      '851c6395-504f-44d9-b017-6c10cdfd3de1': 'Ao Ponto Comidas Brasileiras',
      '758a1a94-d7e3-46b0-83fc-a35e16a6eec5': 'Ao Ponto Burgers & Sanduíches',
      '517ac701-53b4-4bb4-a74c-ca0220533b87': 'Ao Ponto Carnes'
    };
    const nomeLoja = details?.merchant?.name || LOJAS_IFOOD[merchantId] || 'Ao Ponto iFood';

    const numeroCurto = (orderId && orderId.length >= 4) ? orderId.slice(-4).toUpperCase() : 'IFOOD';
    const numeroExibicao = details?.displayId ? String(details.displayId).trim() : numeroCurto;
    const clienteNome = details?.customer?.name ? String(details.customer.name).trim() : `Cliente iFood (${nomeLoja})`;
    const clienteTel = details?.customer?.phone?.number || null;
    const localizador = details?.customer?.phone?.localizer || details?.delivery?.pickupCode || null;
    const enderecoEntrega = details?.delivery?.deliveryAddress;
    
    let rua = 'Endereço registrado no Gestor iFood';
    if (enderecoEntrega?.formattedAddress) {
      rua = enderecoEntrega.formattedAddress;
      if (enderecoEntrega.complement) rua += ` - ${enderecoEntrega.complement}`;
      if (enderecoEntrega.reference) rua += ` (Ref: ${enderecoEntrega.reference})`;
    } else if (enderecoEntrega?.streetName) {
      rua = `${enderecoEntrega.streetName}, ${enderecoEntrega.streetNumber || 'S/N'}${enderecoEntrega.complement ? ' - ' + enderecoEntrega.complement : ''}${enderecoEntrega.reference ? ' (Ref: ' + enderecoEntrega.reference + ')' : ''}`;
    }

    const bairroBruto = enderecoEntrega?.neighborhood || 'Várzea';
    const bairroCanonica = obterNomeBairroCanonica(bairroBruto, rua) || bairroBruto || 'Várzea';
    const taxaEntrega = obterTaxaRepasse(bairroCanonica, rua, '', 'VELOZ') || 10.0;
    const textoBrutoPayload = JSON.stringify(
      details || { orderId, merchantId, nomeLoja, via: 'ifood_api_webhook', data: new Date().toISOString() }
    );

    // 3. Caso não tenha encontrado pelo UUID (ex: pedido lançado no turno atual ainda sem UUID),
    // verifica APENAS dentro do turno atual (criado_em >= inicioTurno) para jamais sobrescrever pedidos de dias anteriores!
    if (!existente && details?.displayId) {
      const inicioTurno = obterInicioTurnoAtual();
      existente = await db.queryOne(
        `SELECT id, numero_pedido, status, cliente, endereco, motoboy_id 
         FROM pedidos 
         WHERE origem = 'IFOOD' 
           AND numero_pedido = ? 
           AND criado_em >= ? 
           AND (pedido_id_origem IS NULL OR pedido_id_origem = '' OR pedido_id_origem = ?)
         LIMIT 1`,
        [numeroExibicao, inicioTurno, orderId]
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
          orderId,
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
      console.log(`✅ [iFood API] Pedido #${numeroExibicao} (${orderId}) atualizado na base (ID ${existente.id}).`);
    } else {
      try {
        await db.execute(
          `INSERT INTO pedidos 
           (numero_pedido, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, localizador, status, texto_bruto, criado_em)
           VALUES (?, 'IFOOD', ?, ?, ?, ?, ?, ?, ?, 'disponivel', ?, DATETIME('now', '-3 hours'))`,
          [
            numeroExibicao,
            orderId,
            clienteNome,
            rua,
            bairroCanonica,
            taxaEntrega,
            clienteTel,
            localizador,
            textoBrutoPayload
          ]
        );
        console.log(`✅ [iFood API] Pedido #${numeroExibicao} (${orderId}) inserido com sucesso no balcão!`);
      } catch (insertErr) {
        // Proteção contra Race Condition: se outra requisição concorrente inseriu no mesmo milissegundo e acionou o UNIQUE INDEX
        if (String(insertErr.message).includes('UNIQUE') || String(insertErr.message).includes('constraint')) {
          console.log(`ℹ️ [iFood API] Concorrência detectada para ${orderId}, atualizando registro existente de forma segura.`);
          await db.execute(
            `UPDATE pedidos 
             SET numero_pedido = ?, cliente = ?, endereco = ?, bairro = ?, taxa_entrega = ?, telefone_cliente = ?, localizador = ?, texto_bruto = ?
             WHERE origem = 'IFOOD' AND pedido_id_origem = ?`,
            [
              numeroExibicao,
              clienteNome,
              rua,
              bairroCanonica,
              taxaEntrega,
              clienteTel,
              localizador,
              textoBrutoPayload,
              orderId
            ]
          );
        } else {
          throw insertErr;
        }
      }
    }

    memoryCache.clear();
  } catch (err) {
    console.warn('⚠️ Erro ao registrar pedido iFood:', err.message);
  }
}

/**
 * Atualiza status local do pedido usando o índice (origem, pedido_id_origem)
 */
async function updateOrderStatus(orderId, novoStatus) {
  try {
    const db = getDb();
    await db.execute(
      "UPDATE pedidos SET status = ? WHERE origem = 'IFOOD' AND pedido_id_origem = ? AND status NOT IN ('em_rota', 'entregue')",
      [novoStatus, orderId]
    );
    memoryCache.clear();
  } catch (err) {
    console.warn('⚠️ Aviso ao atualizar status local do pedido no SQLite:', err.message);
  }
}

/**
 * Retorna os últimos eventos de webhook recebidos (com cache de 3s e consulta indexada LIMIT 30)
 * GET /api/ifood/events
 */
async function listRecentEvents(req, res) {
  const cached = memoryCache.get('ifood_recent_events');
  if (cached) {
    return res.json(cached);
  }

  let dbEvents = [];
  try {
    const db = getDb();
    const rows = await db.query('SELECT id, code, order_id, merchant_id, payload, created_at FROM ifood_events ORDER BY created_at DESC LIMIT 30');
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

  const responsePayload = {
    total: merged.length,
    autoMode: getStoredAutoMode(),
    events: merged
  };

  memoryCache.set('ifood_recent_events', responsePayload, 3000);
  return res.json(responsePayload);
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
    await processNewOrder(orderId);
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
    await processNewOrder(orderId);
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
