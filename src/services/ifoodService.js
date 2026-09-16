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
  const res = await ifoodRequest('/order/v1.0/events:polling?excludeHeartbeat=true', {
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
 * Busca motivos válidos de cancelamento para o pedido
 */
async function getCancellationReasons(orderId) {
  if (orderId && orderId.length >= 30) {
    try {
      const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/cancellationReasons`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (Array.isArray(data?.reasons) ? data.reasons : []);
        if (list.length > 0) {
          return list.map(item => ({
            code: String(item.code || item.cancelCodeId),
            cancelCodeId: String(item.code || item.cancelCodeId),
            description: item.description || 'Motivo de cancelamento'
          }));
        }
      }
    } catch (e) {
      console.warn(`Aviso ao buscar motivos de cancelamento para ${orderId}:`, e.message);
    }
  }

  // Lista padrão oficial iFood conforme documentação técnica
  return [
    { code: '501', cancelCodeId: '501', description: 'Problemas no sistema' },
    { code: '502', cancelCodeId: '502', description: 'Pedido em duplicidade' },
    { code: '503', cancelCodeId: '503', description: 'Item ou cardápio indisponível' },
    { code: '504', cancelCodeId: '504', description: 'Restaurante sem entregador' },
    { code: '505', cancelCodeId: '505', description: 'Cardápio desatualizado' },
    { code: '506', cancelCodeId: '506', description: 'Dificuldade interna do restaurante' },
    { code: '507', cancelCodeId: '507', description: 'Cliente golpista / trote' }
  ];
}

/**
 * Etapa 3 - Solicita cancelamento de pedido identificando o motivo corretamente
 */
async function requestCancellation(orderId, reason = '501', cancellationCode = '501') {
  let code = String(cancellationCode || reason || '501');
  let desc = 'Problemas no sistema';

  try {
    const reasons = await getCancellationReasons(orderId);
    if (Array.isArray(reasons) && reasons.length > 0) {
      const found = reasons.find(r => String(r.code || r.cancelCodeId) === String(code));
      if (found) {
        code = String(found.code || found.cancelCodeId);
        desc = found.description || desc;
      }
    }
  } catch (e) {}

  console.log(`📡 [iFood Cancel] Solicitando cancelamento do pedido ${orderId} com motivo ${code} (${desc})`);

  // iFood API V1.0 aceita { "reason": code, "cancellationCode": code }
  const payload = {
    reason: code,
    cancellationCode: code
  };

  const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/requestCancellation`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (!res.ok && res.status !== 202) {
    const errorBody = await res.text();
    throw new Error(`Erro ao solicitar cancelamento do pedido ${orderId} (${res.status}): ${errorBody}`);
  }

  return {
    success: true,
    status: res.status,
    code,
    description: desc,
    message: `Cancelamento solicitado com sucesso no iFood (Motivo: ${code} - ${desc})`
  };
}

/**
 * Etapa 3 - Aceita a solicitação de cancelamento (CANCELLATION_REQUESTED / Handshake)
 */
async function acceptCancellation(orderId) {
  let lastError = null;

  // 1. Tenta POST /order/v1.0/orders/{id}/acceptCancellation
  try {
    const res = await ifoodRequest(`/order/v1.0/orders/${orderId}/acceptCancellation`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (res.ok || res.status === 202) {
      console.log(`✅ [iFood] Cancelamento aceito via /acceptCancellation para pedido ${orderId}`);
      return { success: true, status: res.status, message: 'Cancelamento aceito via /acceptCancellation' };
    }
    const errText = await res.text();
    lastError = `Status ${res.status}: ${errText}`;
  } catch (e) {
    lastError = e.message;
  }

  // 2. Se a rota retornar 400 ou 404, tenta a rota recomendada pelo relatório Toqan:
  // POST /order/v1.0/orders/{id}/statuses/cancellation-requested
  try {
    const resToqan = await ifoodRequest(`/order/v1.0/orders/${orderId}/statuses/cancellation-requested`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (resToqan.ok || resToqan.status === 202) {
      console.log(`✅ [iFood] Cancelamento aceito via /statuses/cancellation-requested para pedido ${orderId}`);
      return { success: true, status: resToqan.status, message: 'Cancelamento aceito via /statuses/cancellation-requested' };
    }
  } catch (e) {}

  // 3. Fallback: se a API exigir cancelamento com motivo direto da loja
  try {
    const fallbackRes = await requestCancellation(orderId, '501', '501');
    return { success: true, fallback: true, ...fallbackRes };
  } catch (e) {
    throw new Error(`Erro ao confirmar cancelamento do pedido ${orderId}: ${lastError || e.message}`);
  }
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
  ifoodRequest,
  pingPresence,
  getMerchantStatus,
  getMerchantDetails,
  testConnectivity,
  getOrderDetails,
  getCancellationReasons,
  confirmOrder,
  dispatchOrder,
  requestCancellation,
  acceptCancellation,
  denyCancellation
};
