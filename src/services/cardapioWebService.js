const env = require('../config/env');

const BASE_URL = (env.CARDAPIOWEB_API_URL || 'https://integracao.cardapioweb.com').replace(/\/+$/, '');

let cachedMerchant = null;
let cachedMerchantExpiresAt = 0;

/**
 * Executa uma requisição HTTP autenticada para a API Partner v1 do CardápioWeb
 */
async function cardapioWebRequest(endpoint, method = 'GET', body = null) {
  const apiKey = env.CARDAPIOWEB_API_KEY;
  if (!apiKey) {
    throw new Error('CARDAPIOWEB_API_KEY não configurada.');
  }

  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }

  console.log(`📡 [CardápioWeb API] ${method} ${endpoint}`);
  const res = await fetch(url, options);
  const text = await res.text();

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const errMsg = (data && (data.message || data.error || (Array.isArray(data.errors) ? data.errors.join(', ') : null))) || `HTTP ${res.status}`;
    throw new Error(`Erro na API CardápioWeb (${res.status}): ${errMsg}`);
  }

  return data;
}

/**
 * Consulta dados do estabelecimento no CardápioWeb (GET /api/partner/v1/merchant)
 * Com cache em memória de 60s para evitar chamadas externas desnecessárias.
 */
async function getMerchantInfo(force = false) {
  const now = Date.now();
  if (!force && cachedMerchant && cachedMerchantExpiresAt > now) {
    return cachedMerchant;
  }

  const data = await cardapioWebRequest('/api/partner/v1/merchant', 'GET');
  if (data && data.id) {
    cachedMerchant = data;
    cachedMerchantExpiresAt = now + 60000;
  }
  return data;
}

/**
 * Consulta detalhes completos de um pedido (GET /api/partner/v1/orders/{order_id})
 */
async function getOrderDetails(orderId) {
  if (!orderId) {
    throw new Error('order_id é obrigatório para consultar detalhes no CardápioWeb.');
  }
  return cardapioWebRequest(`/api/partner/v1/orders/${encodeURIComponent(String(orderId))}`, 'GET');
}

/**
 * Lista pedidos em andamento na loja (GET /api/partner/v1/orders)
 */
async function listActiveOrders() {
  return cardapioWebRequest('/api/partner/v1/orders', 'GET');
}

/**
 * Confirma um pedido pendente (POST /api/partner/v1/orders/{order_id}/confirm)
 */
async function confirmOrder(orderId) {
  return cardapioWebRequest(`/api/partner/v1/orders/${encodeURIComponent(String(orderId))}/confirm`, 'POST');
}

/**
 * Marca pedido como pronto / saiu para entrega (POST /api/partner/v1/orders/{order_id}/ready)
 */
async function readyOrder(orderId) {
  return cardapioWebRequest(`/api/partner/v1/orders/${encodeURIComponent(String(orderId))}/ready`, 'POST');
}

/**
 * Marca pedido delivery como entregue (POST /api/partner/v1/orders/{order_id}/delivered)
 */
async function deliveredOrder(orderId) {
  return cardapioWebRequest(`/api/partner/v1/orders/${encodeURIComponent(String(orderId))}/delivered`, 'POST');
}

/**
 * Finaliza / conclui um pedido (POST /api/partner/v1/orders/{order_id}/finalize)
 */
async function finalizeOrder(orderId) {
  return cardapioWebRequest(`/api/partner/v1/orders/${encodeURIComponent(String(orderId))}/finalize`, 'POST');
}

/**
 * Cancela um pedido (POST /api/partner/v1/orders/{order_id}/cancel)
 */
async function cancelOrder(orderId, cancellationReason = 'Pedido cancelado pelo estabelecimento') {
  return cardapioWebRequest(`/api/partner/v1/orders/${encodeURIComponent(String(orderId))}/cancel`, 'POST', {
    cancellation_reason: String(cancellationReason)
  });
}

module.exports = {
  cardapioWebRequest,
  getMerchantInfo,
  getOrderDetails,
  listActiveOrders,
  confirmOrder,
  readyOrder,
  deliveredOrder,
  finalizeOrder,
  cancelOrder
};
