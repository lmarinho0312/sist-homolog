const ifoodService = require('./ifoodService');
const ninetyNineFoodService = require('./ninetyNineFoodService');
const { getDb } = require('../database/db');

// Cache em memória de pedidos já despachados na plataforma (evita qualquer chamada duplicada no mesmo processo)
const dispatchedOrderIdsMemory = new Set();

/**
 * Extrai metadados da plataforma (orderId oficial e appShopId da 99Food) a partir do registro do pedido.
 */
function extrairMetadadosPlataforma(pedido) {
  if (!pedido) return { origem: '', orderId: null, appShopId: null };

  const origem = String(pedido.origem || '').trim().toUpperCase();
  let orderId = pedido.pedido_id_origem ? String(pedido.pedido_id_origem).trim() : null;
  let appShopId = null;

  if (pedido.texto_bruto && typeof pedido.texto_bruto === 'string') {
    try {
      const safeRaw = pedido.texto_bruto.replace(/"(order_id|app_id|shop_id|event_id)":\s*(\d{15,})/g, '"$1":"$2"');
      const parsed = JSON.parse(safeRaw);
      if (origem === 'IFOOD') {
        if (!orderId && (parsed.id || parsed.orderId)) {
          orderId = String(parsed.id || parsed.orderId).trim();
        }
      } else if (origem === '99FOOD' || origem.includes('99')) {
        const rawOrderId = parsed?.data?.order_info?.order_id || parsed?.data?.order_id || parsed?.order_id || parsed?.orderId;
        if (!orderId && rawOrderId) {
          orderId = String(rawOrderId).trim();
        }
        const rawShopId = parsed?.app_shop_id || parsed?.data?.order_info?.shop?.app_shop_id || parsed?.data?.shop?.app_shop_id;
        if (rawShopId) {
          appShopId = String(rawShopId).trim();
        }
      }
    } catch (_) {}
  }

  return { origem, orderId, appShopId };
}

/**
 * Verifica no banco de eventos dos webhooks (e no cache em memória) se o pedido JÁ foi despachado
 * pela cozinha na plataforma (ou por uma retirada anterior), evitando enviar requisições redundantes/inválidas
 * para a API do iFood ou da 99Food.
 */
async function verificarJaDespachadoNaPlataforma(origem, orderId) {
  if (!orderId) return false;
  const cacheKey = `${origem}:${orderId}`;
  if (dispatchedOrderIdsMemory.has(cacheKey)) {
    return true;
  }

  try {
    const db = getDb();
    if (origem === 'IFOOD') {
      const ev = await db.queryOne(
        `SELECT id, code FROM ifood_events 
         WHERE order_id = ? 
           AND code IN ('DSP', 'DISPATCHED', 'CON', 'CONCLUDED', 'CAN', 'CANCELLED', 'DSP_AUTO')
         LIMIT 1`,
        [String(orderId)]
      );
      if (ev) {
        dispatchedOrderIdsMemory.add(cacheKey);
        return true;
      }
    } else if (origem === '99FOOD') {
      const cleanId = String(orderId).trim();
      let ev = await db.queryOne(
        `SELECT id, type FROM food99_events 
         WHERE order_id = ?
           AND type IN ('orderReady', 'orderDelivering', 'orderDispatch', 'orderFinish', 'orderCancel', 'orderDispatchedAuto')
         LIMIT 1`,
        [cleanId]
      );
      if (!ev && cleanId.length >= 18 && cleanId.endsWith('000')) {
        ev = await db.queryOne(
          `SELECT id, type FROM food99_events 
           WHERE order_id LIKE ?
             AND type IN ('orderReady', 'orderDelivering', 'orderDispatch', 'orderFinish', 'orderCancel', 'orderDispatchedAuto')
           LIMIT 1`,
          [`${cleanId.slice(0, 15)}%`]
        );
      }
      if (ev) {
        dispatchedOrderIdsMemory.add(cacheKey);
        return true;
      }
    }
  } catch (_) {}

  return false;
}

/**
 * Registra localmente que o pedido já teve seu despacho enviado, garantindo que
 * (mesmo se o motoboy abandonar e outro retirar) NUNCA seja enviada uma segunda requisição para a plataforma.
 */
async function marcarComoDespachadoLocalmente(origem, orderId, appShopId = '') {
  if (!orderId) return;
  const cacheKey = `${origem}:${orderId}`;
  dispatchedOrderIdsMemory.add(cacheKey);

  try {
    const db = getDb();
    const nowIso = new Date().toISOString();
    if (origem === 'IFOOD') {
      await db.execute(
        `INSERT OR REPLACE INTO ifood_events (id, code, order_id, merchant_id, payload, created_at)
         VALUES (?, 'DSP_AUTO', ?, '', ?, ?)`,
        [`auto-dsp-${orderId}`, String(orderId), JSON.stringify({ autoDispatched: true, timestamp: nowIso }), nowIso]
      );
    } else if (origem === '99FOOD') {
      await db.execute(
        `INSERT OR REPLACE INTO food99_events (id, type, order_id, shop_id, payload, created_at)
         VALUES (?, 'orderDispatchedAuto', ?, ?, ?, ?)`,
        [`auto-dsp-99-${orderId}`, String(orderId), String(appShopId || ''), JSON.stringify({ autoDispatched: true, timestamp: nowIso }), nowIso]
      );
    }
  } catch (_) {}
}

/**
 * Monta objeto courier_info do entregador para envio à 99Food
 */
function montarCourierMotoboy(motoboy) {
  const nomeCompleto = String(motoboy?.nome || 'Entregador Ao Ponto').trim();
  const partes = nomeCompleto.split(/\s+/).filter(Boolean);
  const firstName = partes[0] || 'Entregador';
  const lastName = partes.length > 1 ? partes.slice(1).join(' ') : 'AoPonto';
  const telefoneLimpo = String(motoboy?.telefone || '21966770779').replace(/\D/g, '') || '21966770779';

  return {
    id: motoboy?.id ? `motoboy_${motoboy.id}` : 'courier_01',
    name: nomeCompleto,
    firstName,
    lastName,
    phone: telefoneLimpo
  };
}

/**
 * Executa o despacho na API externa (APENAS iFood e 99Food; CardápioWeb e Manual são ignorados).
 * - Antes de enviar qualquer requisição HTTP para a plataforma, verifica se a cozinha já despachou o pedido
 *   (via eventos recebidos no Webhook ou registro de despacho anterior).
 * - Se já foi despachado pela cozinha, NÃO envia nenhuma requisição repetida à API da plataforma (zero risco de erro 4xx ou penalidade).
 * - Se ainda não foi despachado, envia UMA ÚNICA requisição limpa de despacho e grava o estado.
 */
async function executarDespachoPlataformaInterno(pedido, motoboy = null) {
  const { origem, orderId, appShopId } = extrairMetadadosPlataforma(pedido);

  // Regra de negócio: CardápioWeb e pedidos manuais NÃO despacham via API externa
  if (origem !== 'IFOOD' && origem !== '99FOOD') {
    return {
      attempted: false,
      dispatched: false,
      platform: origem || 'MANUAL',
      reason: 'plataforma_sem_despacho_automatico'
    };
  }

  if (!orderId) {
    console.warn(`⚠️ [Auto-Dispatch ${origem}] Pedido #${pedido?.numero_pedido || pedido?.id} sem pedido_id_origem válido para despacho.`);
    return {
      attempted: false,
      dispatched: false,
      platform: origem,
      reason: 'order_id_ausente'
    };
  }

  // 0. Proteção Anti-Requisição Duplicada: se a cozinha já despachou na plataforma (ou já foi despachado antes),
  // NÃO faz nenhuma chamada HTTP externa para não gerar erros 4xx nas plataformas!
  const jaDespachado = await verificarJaDespachadoNaPlataforma(origem, orderId);
  if (jaDespachado) {
    console.log(`ℹ️ [Auto-Dispatch ${origem}] Pedido #${pedido.numero_pedido} (${orderId}) já consta como despachado pela cozinha/plataforma. Nenhuma requisição extra enviada.`);
    return {
      attempted: false,
      dispatched: false,
      alreadyDispatchedOrIgnored: true,
      skippedExternalRequest: true,
      platform: origem,
      orderId
    };
  }

  // ── 1. DESPACHO AUTOMÁTICO IFOOD (1 única chamada limpa) ─────────────────────
  if (origem === 'IFOOD') {
    try {
      await ifoodService.dispatchOrder(orderId);
      await marcarComoDespachadoLocalmente('IFOOD', orderId);
      console.log(`🚀 [Auto-Dispatch iFood] Pedido #${pedido.numero_pedido} (${orderId}) despachado com sucesso no iFood!`);
      return {
        attempted: true,
        dispatched: true,
        platform: 'IFOOD',
        orderId
      };
    } catch (errFirst) {
      // Marca localmente para nunca insistir nem repetir chamadas se a cozinha já havia despachado segundos antes
      await marcarComoDespachadoLocalmente('IFOOD', orderId);
      console.log(`ℹ️ [Auto-Dispatch iFood] Pedido #${pedido.numero_pedido} (${orderId}) já havia sido despachado pela cozinha ou não requer transição: ${errFirst.message}`);
      return {
        attempted: true,
        dispatched: false,
        alreadyDispatchedOrIgnored: true,
        platform: 'IFOOD',
        orderId,
        detail: errFirst.message
      };
    }
  }

  // ── 2. DESPACHO AUTOMÁTICO 99FOOD (orderReady + selfdelivery/dispatch) ──────
  if (origem === '99FOOD') {
    let targetOrderId = String(orderId).trim();

    // Fallback de recuperação de precisão: se o orderId no pedido terminava em '000' (criado antes do fix de 64-bit),
    // busca o order_id real de 19 dígitos na tabela food99_events pelo prefixo de 15 dígitos.
    if (targetOrderId.length >= 18 && targetOrderId.endsWith('000')) {
      try {
        const db = getDb();
        const prefix = targetOrderId.slice(0, 15);
        const evReal = await db.queryOne(
          `SELECT order_id, shop_id FROM food99_events 
           WHERE order_id LIKE ? AND order_id NOT LIKE '%000' 
           ORDER BY created_at DESC LIMIT 1`,
          [`${prefix}%`]
        );
        if (evReal && evReal.order_id) {
          targetOrderId = String(evReal.order_id).trim();
          console.log(`🔧 [Auto-Dispatch 99Food] order_id recuperado de food99_events para #${pedido.numero_pedido}: ${targetOrderId}`);
        }
      } catch (_) {}
    }

    const courier = montarCourierMotoboy(motoboy);
    let readySuccess = false;
    let dispatchSuccess = false;
    let lastErrorMsg = '';

    // 2.1. Notifica na 99Food que o pedido saiu para entrega (/v1/order/order/ready -> status 400: Order picked up by courier / In transit)
    try {
      await ninetyNineFoodService.orderReady(targetOrderId, appShopId);
      readySuccess = true;
      console.log(`✅ [Auto-Dispatch 99Food] orderReady enviado com sucesso para #${pedido.numero_pedido} (${targetOrderId} | Loja: ${appShopId || 'padrão'})!`);
    } catch (errReady) {
      lastErrorMsg = errReady.message || '';
      console.log(`ℹ️ [Auto-Dispatch 99Food] Retorno orderReady #${pedido.numero_pedido} (${targetOrderId}): ${lastErrorMsg}`);
    }

    // 2.2. Envia também o vínculo do entregador na modalidade entrega própria (/v1/order/selfdelivery/dispatch)
    try {
      await ninetyNineFoodService.dispatchOrder(targetOrderId, courier, appShopId);
      dispatchSuccess = true;
      console.log(`🚀 [Auto-Dispatch 99Food] selfdelivery/dispatch enviado para #${pedido.numero_pedido} (${targetOrderId}) com entregador ${courier.name}!`);
    } catch (errDisp) {
      lastErrorMsg = errDisp.message || lastErrorMsg;
      console.log(`ℹ️ [Auto-Dispatch 99Food] Retorno selfdelivery/dispatch #${pedido.numero_pedido} (${targetOrderId}): ${errDisp.message}`);
    }

    if (readySuccess || dispatchSuccess) {
      await marcarComoDespachadoLocalmente('99FOOD', targetOrderId, appShopId);
      if (targetOrderId !== orderId) {
        await marcarComoDespachadoLocalmente('99FOOD', orderId, appShopId);
      }
      return {
        attempted: true,
        dispatched: true,
        readySuccess,
        dispatchSuccess,
        platform: '99FOOD',
        orderId: targetOrderId,
        appShopId
      };
    }

    return {
      attempted: true,
      dispatched: false,
      alreadyDispatchedOrIgnored: true,
      platform: '99FOOD',
      orderId: targetOrderId,
      appShopId,
      detail: lastErrorMsg
    };
  }

  return { attempted: false, dispatched: false, platform: origem };
}

/**
 * Wrapper seguro com timeout máximo (não trava o app do motoboy mesmo se a API externa oscilar).
 */
async function despacharPedidoPlataformaSeguro(pedido, motoboy = null, timeoutMs = 8000) {
  try {
    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve({
          attempted: true,
          dispatched: false,
          timedOut: true,
          platform: String(pedido?.origem || '').toUpperCase()
        });
      }, timeoutMs);
    });

    const result = await Promise.race([
      executarDespachoPlataformaInterno(pedido, motoboy),
      timeoutPromise
    ]);

    if (timer) clearTimeout(timer);
    return result;
  } catch (err) {
    console.warn(`⚠️ [Auto-Dispatch Seguro] Exceção capturada e isolada:`, err.message);
    return {
      attempted: true,
      dispatched: false,
      error: err.message
    };
  }
}

module.exports = {
  extrairMetadadosPlataforma,
  verificarJaDespachadoNaPlataforma,
  marcarComoDespachadoLocalmente,
  montarCourierMotoboy,
  despacharPedidoPlataformaSeguro
};
