const crypto = require('crypto');
const env = require('../config/env');
const { getDb } = require('../database/db');

const BASE_URL = env.FOOD99_API_URL || 'https://openapi.99food.com';

// Cache de auth_token por loja (app_shop_id -> { token, expiresAt })
const tokenCacheByShop = new Map();

/**
 * Obtém ou atualiza automaticamente o auth_token da loja na 99Food.
 * Suporta múltiplas lojas (Ao Ponto Carnes, Burgers e Comidas Brasileiras) via customAppShopId.
 */
async function getAuthToken(forceRefresh = false, customAppShopId = null) {
  const now = Date.now();
  let appShopId = String(customAppShopId || env.FOOD99_APP_SHOP_ID || '').trim();

  // Se nenhuma loja foi informada e a variável de ambiente está vazia, tenta descobrir a primeira loja autorizada
  if (!appShopId) {
    try {
      const shops = await getAuthorizedShops(false);
      if (shops && Array.isArray(shops.shop_list) && shops.shop_list.length > 0) {
        appShopId = String(shops.shop_list[0].app_shop_id || '').trim();
      }
    } catch (_) {}
  }

  if (!appShopId) {
    throw new Error('app_shop_id da 99Food não configurado nem identificado no pedido.');
  }

  const cached = tokenCacheByShop.get(appShopId);
  if (!forceRefresh && cached && cached.token && cached.expiresAt > now + 30000) {
    return cached.token;
  }

  // Consulta cache persistente no Turso (evita chamada extra em cold start serverless da Vercel)
  if (!forceRefresh) {
    try {
      const db = getDb();
      const row = await db.queryOne("SELECT value FROM app_cache WHERE key = ?", [`food99_token_${appShopId}`]);
      if (row && row.value) {
        const parsed = JSON.parse(row.value);
        if (parsed && parsed.token && parsed.expiresAt > now + 60000) {
          tokenCacheByShop.set(appShopId, parsed);
          return parsed.token;
        }
      }
    } catch (_) {}
  }

  const appId = env.FOOD99_APP_ID;
  const appSecret = env.FOOD99_APP_SECRET;

  const getUrl = `${BASE_URL}/v1/auth/authtoken/get?app_id=${encodeURIComponent(appId)}&app_secret=${encodeURIComponent(appSecret)}&app_shop_id=${encodeURIComponent(appShopId)}`;
  const refreshUrl = `${BASE_URL}/v1/auth/authtoken/refresh?app_id=${encodeURIComponent(appId)}&app_secret=${encodeURIComponent(appSecret)}&app_shop_id=${encodeURIComponent(appShopId)}`;

  console.log(`🔑 [99Food] Solicitando token para loja ${appShopId}...`);
  let res = await fetch(getUrl);
  let data = await res.json();

  // Se retornou 10102 (The store authorization information has expired), faz o refresh primeiro
  if (data.errno === 10102 || forceRefresh) {
    console.log(`🔄 [99Food] Token expirado ou refresh forçado (${appShopId}). Executando authtoken/refresh...`);
    await fetch(refreshUrl);
    res = await fetch(getUrl);
    data = await res.json();
  }

  if (data.errno !== 0 || !data.data?.auth_token) {
    throw new Error(`Falha ao obter auth_token da 99Food para loja ${appShopId} (${data.errno}): ${data.errmsg || 'Erro desconhecido'}`);
  }

  const token = data.data.auth_token;
  const expiresAt = data.data.token_expiration_time
    ? data.data.token_expiration_time * 1000
    : now + (180 * 1000);

  const tokenRecord = { token, expiresAt };
  tokenCacheByShop.set(appShopId, tokenRecord);
  try {
    const db = getDb();
    await db.execute(
      "INSERT OR REPLACE INTO app_cache (key, value, updated_at) VALUES (?, ?, ?)",
      [`food99_token_${appShopId}`, JSON.stringify(tokenRecord), now]
    );
  } catch (_) {}

  console.log(`✅ [99Food] Token ativo para loja ${appShopId}! Expira em: ${new Date(expiresAt).toISOString()}`);
  return token;
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
 * Wrapper de requisição HTTP para a API da 99Food com tratamento e renovação automática de token por loja
 */
async function ninetyNineRequest(endpoint, body = {}, method = 'POST', customAppShopId = null) {
  let token = await getAuthToken(false, customAppShopId);
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
      // Compatibilidade total com Swagger v1 (query params) e OpenAPI doc (POST JSON body)
      if (body && body.order_id && (endpoint.includes('/order/ready') || endpoint.includes('/order/confirm') || endpoint.includes('/order/delivered'))) {
        const qParams = new URLSearchParams({ auth_token: authToken, order_id: String(body.order_id) });
        url += `?${qParams.toString()}`;
      }
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
      const safeText = text.replace(/"(order_id|app_id|shop_id|event_id|app_shop_id)":\s*(\d{15,})/g, '"$1":"$2"');
      json = JSON.parse(safeText);
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
    token = await getAuthToken(true, customAppShopId);
    response = await execute(token);
  }

  // Se atingiu rate limit de janela de 10s (errno 10005), aguarda 1.1s e repete automaticamente
  if (response.data?.errno === 10005) {
    console.warn(`⏳ [99Food API] Rate limit 10005 em ${endpoint}. Aguardando 1.1s para repetir...`);
    await new Promise((r) => setTimeout(r, 1100));
    response = await execute(token);
  }

  if (!response.ok || (response.data.errno !== undefined && response.data.errno !== 0)) {
    const errorMsg = response.data.errmsg || response.data.message || `Erro HTTP ${response.status}`;
    const err = new Error(`Erro na API 99Food (${response.data.errno || response.status}): ${errorMsg}`);
    err.errno = response.data?.errno;
    err.status = response.status;
    throw err;
  }

  return response.data;
}

/**
 * Consulta detalhes completos de um pedido (GET /v1/order/order/detail)
 */
async function getOrderDetails(orderId, customAppShopId = null) {
  return ninetyNineRequest('/v1/order/order/detail', { order_id: String(orderId) }, 'GET', customAppShopId);
}

/**
 * Confirma recebimento do pedido (POST /v1/order/order/confirm)
 */
async function confirmOrder(orderId, customAppShopId = null) {
  return ninetyNineRequest('/v1/order/order/confirm', {
    order_id: String(orderId)
  }, 'POST', customAppShopId);
}

/**
 * Notifica que o pedido está pronto para entrega (POST /v1/order/order/ready)
 */
async function orderReady(orderId, customAppShopId = null) {
  return ninetyNineRequest('/v1/order/order/ready', {
    order_id: String(orderId)
  }, 'POST', customAppShopId);
}

/**
 * Despacha o pedido com entrega própria da loja (POST /v1/order/selfdelivery/dispatch)
 */
async function dispatchOrder(orderId, courier = {}, customAppShopId = null) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cleanPhone = String(courier.phone || '21966770779').replace(/\D/g, '') || '21966770779';
  return ninetyNineRequest('/v1/order/selfdelivery/dispatch', {
    order_id: String(orderId),
    courier_info: {
      courier_id: String(courier.id || 'courier_01'),
      courier_name: courier.name || 'Entregador SistRastreamento',
      courier_first_name: courier.firstName || 'Entregador',
      courier_last_name: courier.lastName || 'Rastreador',
      courier_phone_code: '+55',
      courier_phone: cleanPhone
    },
    limit_time: {
      pickup_time: nowSec,
      delivery_time: nowSec + 1800
    }
  }, 'POST', customAppShopId);
}

/**
 * Cancela um pedido com motivo oficial (POST /v1/order/order/cancel)
 * reason_id permitidos:
 * 1010 - Item sold out (Item esgotado)
 * 1020 - Store closed for the day (Estabelecimento fechado hoje)
 * 1030 - Store too busy to prepare order (Loja muito ocupada)
 * 1080 - Other reason (Outro motivo)
 */
async function cancelOrder(orderId, reasonId = 1010, reasonText = 'Item esgotado', customAppShopId = null) {
  return ninetyNineRequest('/v1/order/order/cancel', {
    order_id: String(orderId),
    reason_id: Number(reasonId),
    reason: String(reasonText)
  }, 'POST', customAppShopId);
}

/**
 * Gera URL oficial de autorização para o lojista vincular a loja ao aplicativo
 * POST /v1/auth/authorizationpage/getUrl
 */
async function getStoreAuthorizationPageUrl(appId = env.FOOD99_APP_ID) {
  const url = `${BASE_URL}/v1/auth/authorizationpage/getUrl`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: String(appId) })
  });
  const data = await res.json();
  if (data.errno !== 0 || !data.data?.url) {
    throw new Error(`Erro ao gerar link de autorização: ${data.errmsg || 'Falha na API'}`);
  }
  return data.data.url;
}

let cachedShops = null;
let cachedShopsExpiresAt = 0;

/**
 * Consulta a lista de lojas vinculadas ao aplicativo na 99Food
 * GET /v1/shop/list (respeitando limite de 1 chamada a cada 20s)
 */
async function getAuthorizedShops(force = false) {
  const now = Date.now();
  let dbCache = null;

  try {
    const db = getDb();
    const row = await db.queryOne("SELECT value, updated_at FROM app_cache WHERE key = 'food99_shops'");
    if (row && row.value) {
      dbCache = JSON.parse(row.value);
      const age = now - (row.updated_at || 0);
      if (!force && age < 35000) {
        return dbCache;
      }
    }
  } catch (err) {}

  if (!force && cachedShops && cachedShopsExpiresAt > now) {
    return cachedShops;
  }

  const appId = env.FOOD99_APP_ID;
  const params = {
    app_id: appId,
    timestamp: Math.floor(now / 1000)
  };
  params.sign = generateSignature(params, env.FOOD99_APP_SECRET);
  const q = new URLSearchParams(params).toString();
  
  try {
    const res = await fetch(`${BASE_URL}/v1/shop/list?${q}`);
    const text = await res.text();
    const safeText = text.replace(/"(order_id|app_id|shop_id|event_id)":\s*(\d{15,})/g, '"$1":"$2"');
    const data = JSON.parse(safeText);

    if (data.errno === 0 && data.data) {
      cachedShops = data.data;
      cachedShopsExpiresAt = now + 35000;
      try {
        const db = getDb();
        await db.execute(
          "INSERT OR REPLACE INTO app_cache (key, value, updated_at) VALUES ('food99_shops', ?, ?)",
          [JSON.stringify(cachedShops), now]
        );
      } catch (e) {}
      return cachedShops;
    }

    if (data.errno === 10005 && dbCache) {
      return dbCache;
    }

    return dbCache || cachedShops || { total: 0, shop_list: [], error: data.errmsg || 'Falha ao obter lojas' };
  } catch (netErr) {
    return dbCache || cachedShops || { total: 0, shop_list: [], error: netErr.message };
  }
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
  cancelOrder,
  getStoreAuthorizationPageUrl,
  getAuthorizedShops
};
