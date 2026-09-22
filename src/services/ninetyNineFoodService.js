const crypto = require('crypto');
const env = require('../config/env');

const BASE_URL = env.FOOD99_API_URL || 'https://openapi.99food.com';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

/**
 * Obtém ou atualiza automaticamente o auth_token da loja na 99Food
 */
async function getAuthToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedTokenExpiresAt > now + 30000) {
    return cachedToken;
  }

  const appId = env.FOOD99_APP_ID;
  const appSecret = env.FOOD99_APP_SECRET;
  const appShopId = env.FOOD99_APP_SHOP_ID;

  const getUrl = `${BASE_URL}/v1/auth/authtoken/get?app_id=${encodeURIComponent(appId)}&app_secret=${encodeURIComponent(appSecret)}&app_shop_id=${encodeURIComponent(appShopId)}`;
  const refreshUrl = `${BASE_URL}/v1/auth/authtoken/refresh?app_id=${encodeURIComponent(appId)}&app_secret=${encodeURIComponent(appSecret)}&app_shop_id=${encodeURIComponent(appShopId)}`;

  console.log(`🔑 [99Food] Solicitando token para loja ${appShopId}...`);
  let res = await fetch(getUrl);
  let data = await res.json();

  // Se retornou 10102 (The store authorization information has expired), faz o refresh primeiro
  if (data.errno === 10102 || forceRefresh) {
    console.log(`🔄 [99Food] Token expirado ou refresh forçado. Executando authtoken/refresh...`);
    await fetch(refreshUrl);
    res = await fetch(getUrl);
    data = await res.json();
  }

  if (data.errno !== 0 || !data.data?.auth_token) {
    throw new Error(`Falha ao obter auth_token da 99Food (${data.errno}): ${data.errmsg || 'Erro desconhecido'}`);
  }

  cachedToken = data.data.auth_token;
  cachedTokenExpiresAt = data.data.token_expiration_time 
    ? data.data.token_expiration_time * 1000 
    : now + (180 * 1000);

  console.log(`✅ [99Food] Token ativo! Expira em: ${new Date(cachedTokenExpiresAt).toISOString()}`);
  return cachedToken;
}

/**
 * Assina requisições para a 99Food utilizando algoritmo oficial MD5
 */
function generateSignature(params, appSecret = env.FOOD99_APP_SECRET) {
  const sortedKeys = Object.keys(params).sort();
  const signArr = [];
  sortedKeys.forEach(key => {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      signArr.push(`${key}=${params[key]}`);
    }
  });
  const toSign = signArr.join('&') + appSecret;
  return crypto.createHash('md5').update(toSign).digest('hex');
}

/**
 * Validador de assinatura de webhook recebido da 99Food
 */
function verifyWebhookSignature(rawBody, headerSign, appSecret = env.FOOD99_APP_SECRET) {
  if (!headerSign) return true;
  const checkSign = crypto.createHash('md5').update(rawBody + appSecret).digest('hex');
  return checkSign.toLowerCase() === String(headerSign).toLowerCase();
}

/**
 * Wrapper de requisição HTTP para a API da 99Food com tratamento e renovação automática de token
 */
async function ninetyNineRequest(endpoint, body = {}, method = 'POST') {
  let token = await getAuthToken();
  const execute = async (authToken) => {
    let url = `${BASE_URL}${endpoint}`;
    let options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (method === 'GET') {
      const qParams = new URLSearchParams({ auth_token: authToken, ...body });
      url += `?${qParams.toString()}`;
    } else {
      options.body = JSON.stringify({
        auth_token: authToken,
        ...body
      });
    }

    console.log(`📡 [99Food API] ${method} ${endpoint}...`, method === 'POST' ? options.body : url);
    const res = await fetch(url, options);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { raw: text };
    }
    console.log(`📥 [99Food API] Resposta (${res.status}):`, JSON.stringify(json));
    return { status: res.status, ok: res.ok, data: json };
  };

  let response = await execute(token);

  // Se token expirou ou inválido (10100 ou 10102), força renovação e tenta novamente
  if (response.data?.errno === 10100 || response.data?.errno === 10102) {
    console.warn(`⚠️ [99Food API] Token expirado (${response.data.errno}). Renovando e repetindo chamada...`);
    token = await getAuthToken(true);
    response = await execute(token);
  }

  if (!response.ok || (response.data.errno !== undefined && response.data.errno !== 0)) {
    const errorMsg = response.data.errmsg || response.data.message || `Erro HTTP ${response.status}`;
    throw new Error(`Erro na API 99Food (${response.data.errno || response.status}): ${errorMsg}`);
  }

  return response.data;
}

/**
 * Consulta detalhes completos de um pedido (GET /v1/order/order/detail)
 */
async function getOrderDetails(orderId) {
  return ninetyNineRequest('/v1/order/order/detail', { order_id: String(orderId) }, 'GET');
}

/**
 * Confirma recebimento do pedido (POST /v1/order/order/confirm)
 */
async function confirmOrder(orderId) {
  return ninetyNineRequest('/v1/order/order/confirm', {
    order_id: String(orderId)
  });
}

/**
 * Notifica que o pedido está pronto para entrega (POST /v1/order/order/ready)
 */
async function orderReady(orderId) {
  return ninetyNineRequest('/v1/order/order/ready', {
    order_id: String(orderId)
  });
}

/**
 * Despacha o pedido com entrega própria da loja (POST /v1/order/selfdelivery/dispatch)
 */
async function dispatchOrder(orderId, courier = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return ninetyNineRequest('/v1/order/selfdelivery/dispatch', {
    order_id: String(orderId),
    courier_info: {
      courier_id: courier.id || 'courier_01',
      courier_name: courier.name || 'Entregador SistRastreamento',
      courier_first_name: courier.firstName || 'Entregador',
      courier_last_name: courier.lastName || 'Rastreador',
      courier_phone_code: '+55',
      courier_phone: courier.phone || '21966770779'
    },
    limit_time: {
      pickup_time: nowSec,
      delivery_time: nowSec + 1800
    }
  });
}

/**
 * Cancela um pedido com motivo oficial (POST /v1/order/order/cancel)
 * reason_id permitidos:
 * 1010 - Item sold out (Item esgotado)
 * 1020 - Store closed for the day (Estabelecimento fechado hoje)
 * 1030 - Store too busy to prepare order (Loja muito ocupada)
 * 1080 - Other reason (Outro motivo)
 */
async function cancelOrder(orderId, reasonId = 1010, reasonText = 'Item esgotado') {
  return ninetyNineRequest('/v1/order/order/cancel', {
    order_id: String(orderId),
    reason_id: Number(reasonId),
    reason: String(reasonText)
  });
}

module.exports = {
  getAuthToken,
  generateSignature,
  verifyWebhookSignature,
  ninetyNineRequest,
  getOrderDetails,
  confirmOrder,
  orderReady,
  dispatchOrder,
  cancelOrder
};
