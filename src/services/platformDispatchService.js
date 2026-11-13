const ifoodService = require('./ifoodService');
const ninetyNineFoodService = require('./ninetyNineFoodService');

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
 * - Se a cozinha já tiver despachado o pedido antes na plataforma (para proteger o ranqueamento/tempo),
 *   a rejeição de transição da plataforma é tratada de forma transparente, sem quebrar nem travar a retirada.
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

  // ── 1. DESPACHO AUTOMÁTICO IFOOD ─────────────────────────────────────────────
  if (origem === 'IFOOD') {
    try {
      await ifoodService.dispatchOrder(orderId);
      console.log(`🚀 [Auto-Dispatch iFood] Pedido #${pedido.numero_pedido} (${orderId}) despachado com sucesso no iFood!`);
      return {
        attempted: true,
        dispatched: true,
        platform: 'IFOOD',
        orderId
      };
    } catch (errFirst) {
      // Caso o pedido ainda estivesse em PLACED (não confirmado), tenta confirmar e despachar em seguida
      try {
        await ifoodService.confirmOrder(orderId);
        await ifoodService.dispatchOrder(orderId);
        console.log(`🚀 [Auto-Dispatch iFood] Pedido #${pedido.numero_pedido} (${orderId}) confirmado e despachado com sucesso no iFood!`);
        return {
          attempted: true,
          dispatched: true,
          platform: 'IFOOD',
          orderId
        };
      } catch (errSecond) {
        // Cenário esperado quando a cozinha já despachou antes no Gestor iFood para não atrasar o pedido
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
  }

  // ── 2. DESPACHO AUTOMÁTICO 99FOOD ────────────────────────────────────────────
  if (origem === '99FOOD') {
    const courier = montarCourierMotoboy(motoboy);
    try {
      // Notifica orderReady silenciosamente caso a plataforma exija antes do selfdelivery/dispatch
      try {
        await ninetyNineFoodService.orderReady(orderId, appShopId);
      } catch (_) {}

      await ninetyNineFoodService.dispatchOrder(orderId, courier, appShopId);
      console.log(`🚀 [Auto-Dispatch 99Food] Pedido #${pedido.numero_pedido} (${orderId} | Loja: ${appShopId || 'padrão'}) despachado na 99Food com entregador ${courier.name}!`);
      return {
        attempted: true,
        dispatched: true,
        platform: '99FOOD',
        orderId,
        appShopId
      };
    } catch (errFirst) {
      // Se o pedido ainda estava aguardando confirmação na 99Food, tenta confirmar -> ready -> dispatch
      try {
        await ninetyNineFoodService.confirmOrder(orderId, appShopId).catch(() => {});
        await ninetyNineFoodService.orderReady(orderId, appShopId).catch(() => {});
        await ninetyNineFoodService.dispatchOrder(orderId, courier, appShopId);
        console.log(`🚀 [Auto-Dispatch 99Food] Pedido #${pedido.numero_pedido} (${orderId}) confirmado e despachado na 99Food!`);
        return {
          attempted: true,
          dispatched: true,
          platform: '99FOOD',
          orderId,
          appShopId
        };
      } catch (errSecond) {
        // Cenário esperado quando a cozinha já despachou antes na 99Food para proteger o ranqueamento da loja
        console.log(`ℹ️ [Auto-Dispatch 99Food] Pedido #${pedido.numero_pedido} (${orderId}) já havia sido despachado pela cozinha ou não requer transição: ${errFirst.message}`);
        return {
          attempted: true,
          dispatched: false,
          alreadyDispatchedOrIgnored: true,
          platform: '99FOOD',
          orderId,
          appShopId,
          detail: errFirst.message
        };
      }
    }
  }

  return { attempted: false, dispatched: false, platform: origem };
}

/**
 * Wrapper seguro com timeout máximo (não trava o app do motoboy mesmo se a API externa oscilar).
 */
async function despacharPedidoPlataformaSeguro(pedido, motoboy = null, timeoutMs = 2600) {
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
  montarCourierMotoboy,
  despacharPedidoPlataformaSeguro
};
