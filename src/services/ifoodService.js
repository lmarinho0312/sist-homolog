const config = require('../config/env');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Obtém ou renova o token de acesso OAuth2 da API do iFood
 * utilizando o fluxo Client Credentials
 */
async function getAccessToken(forceRefresh = false) {
  const clientId = config.IFOOD_CLIENT_ID;
  const clientSecret = config.IFOOD_CLIENT_SECRET;
  const apiUrl = config.IFOOD_API_URL || 'https://merchant-api.ifood.com.br';

  if (!clientId || !clientSecret) {
    throw new Error('Credenciais do iFood não configuradas. Preencha IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET no arquivo .env');
  }

  const now = Date.now();
  // Reutiliza o token em cache com margem de segurança de 2 minutos (120000ms)
  if (!forceRefresh && cachedToken && now < (tokenExpiresAt - 120000)) {
    return cachedToken;
  }

  const tokenUrl = `${apiUrl}/authentication/v1.0/oauth/token`;
  const params = new URLSearchParams();
  params.append('grantType', 'client_credentials');
  params.append('clientId', clientId);
  params.append('clientSecret', clientSecret);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errText = await response.text();
    let parsedErr = errText;
    try { parsedErr = JSON.parse(errText); } catch (_) {}
    const msg = parsedErr?.error?.message || parsedErr?.message || errText || response.statusText;
    throw new Error(`Falha na autenticação iFood (${response.status}): ${msg}`);
  }

  const data = await response.json();
  cachedToken = data.accessToken;
  // expiresIn normalmente é em segundos (ex: 21600s = 6 horas)
  const expiresInMs = (data.expiresIn || 21600) * 1000;
  tokenExpiresAt = now + expiresInMs;

  return cachedToken;
}

/**
 * Wrapper para requisições autenticadas à API do iFood
 */
async function ifoodRequest(endpoint, options = {}) {
  const apiUrl = config.IFOOD_API_URL || 'https://merchant-api.ifood.com.br';
  const url = `${apiUrl}${endpoint}`;
  const token = await getAccessToken();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  // Se o token tiver expirado na API, fazemos 1 retentativa forçando novo token
  if (response.status === 401) {
    console.warn('⚠️ Token iFood rejeitado (401). Renovando token e retentando...');
    const freshToken = await getAccessToken(true);
    headers['Authorization'] = `Bearer ${freshToken}`;
    return fetch(url, { ...options, headers });
  }

  return response;
}

/**
 * Etapa 1 - Conectividade: Consulta o status de funcionamento da loja
 */
async function getMerchantStatus(merchantId = config.IFOOD_MERCHANT_ID) {
  if (!merchantId) {
    throw new Error('Merchant ID não configurado no .env (IFOOD_MERCHANT_ID)');
  }
  const res = await ifoodRequest(`/merchant/v1.0/merchants/${merchantId}/status`);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Erro ao consultar status da loja (${res.status}): ${errorBody}`);
  }
  return await res.json();
}

/**
 * Etapa 1 - Consulta os detalhes cadastrais da loja
 */
async function getMerchantDetails(merchantId = config.IFOOD_MERCHANT_ID) {
  if (!merchantId) {
    throw new Error('Merchant ID não configurado no .env (IFOOD_MERCHANT_ID)');
  }
  const res = await ifoodRequest(`/merchant/v1.0/merchants/${merchantId}`);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Erro ao consultar detalhes da loja (${res.status}): ${errorBody}`);
  }
  return await res.json();
}

/**
 * Mantém a presença do aplicativo ativa no iFood (deixa a loja ONLINE)
 * O iFood exige um polling/ping a cada 30 segundos para manter a validação 'is-connected' em OK
 */
async function pingPresence() {
  const merchantId = config.IFOOD_MERCHANT_ID;
  if (!merchantId) return null;
  const res = await ifoodRequest('/order/v1.0/events:polling?excludeHeartbeat=false', {
    headers: {
      'x-polling-merchants': merchantId
    }
  });
  return { status: res.status, ok: res.ok || res.status === 204 };
}

/**
 * Validação completa da Etapa 1 (Conectividade)
 */
async function testConnectivity() {
  const token = await getAccessToken();
  const merchantId = config.IFOOD_MERCHANT_ID;
  let merchantStatus = null;
  let merchantDetails = null;

  if (merchantId) {
    // 1. Envia ping de presença primeiro para ativar o status ONLINE imediatamente no iFood
    try {
      await pingPresence();
    } catch (e) {
      console.warn('⚠️ Falha ao registrar presença no iFood:', e.message);
    }

    // 2. Consulta o status da loja
    try {
      merchantStatus = await getMerchantStatus(merchantId);
    } catch (e) {
      merchantStatus = { error: e.message };
    }

    // 3. Consulta os detalhes cadastrais da loja
    try {
      merchantDetails = await getMerchantDetails(merchantId);
    } catch (e) {
      merchantDetails = { error: e.message };
    }
  }

  const deliveryStatus = Array.isArray(merchantStatus) 
    ? merchantStatus.find(s => s.operation === 'delivery') 
    : null;
  const isOnline = deliveryStatus?.state === 'OK' && deliveryStatus?.available === true;

  return {
    ok: true,
    etapa: 1,
    descricao: 'Conectividade e Autenticação OAuth2',
    isOnline,
    storeState: deliveryStatus?.state || 'UNKNOWN',
    timestamp: new Date().toISOString(),
    auth: {
      authenticated: !!token,
      tokenPreview: token ? `${token.substring(0, 10)}...${token.slice(-6)}` : null,
      expiresAt: new Date(tokenExpiresAt).toISOString()
    },
    merchant: {
      id: merchantId || 'NÃO CONFIGURADO',
      status: merchantStatus,
      details: merchantDetails
    }
  };
}

/**
 * Busca detalhes completos de um pedido
 */
async function getOrderDetails(orderId) {
  const res = await ifoodRequest(`/order/v1.0/orders/${orderId}`);
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Erro ao consultar pedido ${orderId} (${res.status}): ${errorBody}`);
  }
  return await res.json();
}

/**
 * Etapa 2 - Confirma o pedido recebido (CFM / Confirm)
 */
async function confirmOrder(orderId) {
  const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/confirm`, {
    method: 'POST'
  });
  if (!res.ok && res.status !== 202) {
    const errorBody = await res.text();
    throw new Error(`Erro ao confirmar pedido ${orderId} (${res.status}): ${errorBody}`);
  }
  return { success: true, status: res.status, message: 'Pedido confirmado com sucesso no iFood' };
}

/**
 * Etapa 4 - Despacha o pedido (DSP / Dispatched)
 */
async function dispatchOrder(orderId) {
  const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/dispatch`, {
    method: 'POST'
  });
  if (!res.ok && res.status !== 202) {
    const errorBody = await res.text();
    throw new Error(`Erro ao despachar pedido ${orderId} (${res.status}): ${errorBody}`);
  }
  return { success: true, status: res.status, message: 'Pedido despachado com sucesso no iFood' };
}

/**
 * Etapa 3 - Solicita ou gerencia cancelamento de pedido
 */
async function requestCancellation(orderId, reason = 'PROBLEMAS_OPERACIONAIS', cancellationCode = '501') {
  const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/requestCancellation`, {
    method: 'POST',
    body: JSON.stringify({ reason, cancellationCode })
  });
  if (!res.ok && res.status !== 202) {
    const errorBody = await res.text();
    throw new Error(`Erro ao solicitar cancelamento do pedido ${orderId} (${res.status}): ${errorBody}`);
  }
  return { success: true, status: res.status, message: 'Cancelamento solicitado com sucesso' };
}

/**
 * Etapa 3 - Aceita o cancelamento solicitado pelo cliente
 */
async function acceptCancellation(orderId) {
  const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/acceptCancellation`, {
    method: 'POST'
  });
  if (!res.ok && res.status !== 202) {
    const errorBody = await res.text();
    throw new Error(`Erro ao aceitar cancelamento do pedido ${orderId} (${res.status}): ${errorBody}`);
  }
  return { success: true, status: res.status, message: 'Cancelamento aceito com sucesso' };
}

/**
 * Etapa 3 - Rejeita a solicitação de cancelamento
 */
async function denyCancellation(orderId, reason = 'Pedido já em preparo/despacho') {
  const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/denyCancellation`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
  if (!res.ok && res.status !== 202) {
    const errorBody = await res.text();
    throw new Error(`Erro ao rejeitar cancelamento do pedido ${orderId} (${res.status}): ${errorBody}`);
  }
  return { success: true, status: res.status, message: 'Cancelamento rejeitado' };
}

module.exports = {
  getAccessToken,
  pingPresence,
  getMerchantStatus,
  getMerchantDetails,
  testConnectivity,
  getOrderDetails,
  confirmOrder,
  dispatchOrder,
  requestCancellation,
  acceptCancellation,
  denyCancellation
};
