const { getDb } = require('../database/db');
const memoryCache = require('../utils/memoryCache');

// Caches dedicados de GPS em memória (persistem independentemente de limpezas de cache de pedidos)
const lastMotoboyPos = new Map(); // motoboyId -> { lat, lng, spd, ts }
const lastPedidoPos = new Map();  // pedidoId -> { lat, lng, ts }
const deviceToMotoboyMap = new Map(); // telefone/deviceId -> motoboyId

/**
 * Cálculo da distância Haversine em metros entre duas coordenadas GPS
 */
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Filtro de Outliers com cache em memória para evitar leituras repetidas na tabela pedido_rotas
 */
async function eOutlierGps(db, pedidoId, newLat, newLng) {
  try {
    let ultimoPonto = lastPedidoPos.get(pedidoId);

    if (!ultimoPonto) {
      const dbPonto = await db.queryOne(
        `SELECT latitude, longitude, criado_em FROM pedido_rotas WHERE pedido_id = ? ORDER BY id DESC LIMIT 1`,
        [pedidoId]
      );
      if (!dbPonto) return false;
      const dataStr = dbPonto.criado_em
        ? (dbPonto.criado_em.includes('T') ? dbPonto.criado_em : dbPonto.criado_em.replace(' ', 'T') + '-03:00')
        : null;
      ultimoPonto = {
        lat: Number(dbPonto.latitude),
        lng: Number(dbPonto.longitude),
        ts: dataStr ? new Date(dataStr).getTime() : (Date.now() - 5000)
      };
      lastPedidoPos.set(pedidoId, ultimoPonto);
    }

    const distMetros = calcularDistanciaMetros(ultimoPonto.lat, ultimoPonto.lng, newLat, newLng);

    // Ignorar pontos idênticos ou com deslocamento insignificante (< 4 metros)
    if (distMetros < 4) return true;

    const dtSeconds = Math.max(1, Math.abs((Date.now() - ultimoPonto.ts) / 1000));
    const velocidadeImpliedKmH = (distMetros / dtSeconds) * 3.6;

    // Descartar apenas teletransporte irreal (> 500m em segundos a mais de 180 km/h)
    if (distMetros > 500 && velocidadeImpliedKmH > 180) {
      console.warn(`⚠️ GPS Outlier filtrado: salto de ${distMetros.toFixed(1)}m (${velocidadeImpliedKmH.toFixed(1)} km/h)`);
      return true;
    }

    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Função auxiliar para salvar o ponto GPS no histórico das entregas ativas do motoboy
 */
async function gravarHistoricoRota(db, motoboyId, lat, lng, spd) {
  return; // Otimização Turso: mantém apenas GPS ao vivo na tabela motoboys, zero leituras/escritas em pedido_rotas
  try {
    // Cache curto de 5s para os pedidos em rota de cada motoboy
    const cacheKey = `active_route_orders_${motoboyId}`;
    let pedidosAtivos = memoryCache.get(cacheKey);
    if (!pedidosAtivos) {
      pedidosAtivos = await db.query(
        `SELECT id FROM pedidos WHERE motoboy_id = ? AND status = 'em_rota'`,
        [motoboyId]
      );
      memoryCache.set(cacheKey, pedidosAtivos || [], 5000);
    }

    if (pedidosAtivos && pedidosAtivos.length > 0) {
      for (const p of pedidosAtivos) {
        const descarte = await eOutlierGps(db, p.id, lat, lng);
        if (!descarte) {
          await db.execute(
            `INSERT INTO pedido_rotas (pedido_id, motoboy_id, latitude, longitude, velocidade, criado_em) 
             VALUES (?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
            [p.id, motoboyId, lat, lng, spd]
          );
          lastPedidoPos.set(p.id, { lat, lng, ts: Date.now() });
        }
      }
    }
  } catch (err) {
    console.error('⚠️ Erro ao gravar ponto de histórico da rota:', err.message);
  }
}

/**
 * Verifica se o motoboy se moveu significativamente ou se já passou o tempo de heartbeat (40s)
 * para evitar leituras e escritas desnecessárias no Turso quando o motoboy está parado.
 */
function devePersistirPosicaoMotoboy(motoboyId, lat, lng) {
  const prev = lastMotoboyPos.get(motoboyId);
  const now = Date.now();
  if (!prev) return true;
  const elapsedMs = now - prev.ts;
  const distMetros = calcularDistanciaMetros(prev.lat, prev.lng, lat, lng);
  // Persiste se moveu >= 5 metros OU se já passaram mais de 40 segundos (mantém status online)
  return distMetros >= 5 || elapsedMs >= 40000;
}

/**
 * Endpoint para o Web App do Motoboy enviar sua localização GPS em tempo real (HTML5 Geolocation)
 * POST /api/motoboy/posicao
 */
async function atualizarPosicaoMotoboy(req, res) {
  try {
    const { motoboy_id, id, telefone, latitude, longitude, speed, accuracy } = req.body || {};

    const targetIdRaw = motoboy_id || id;
    if (!targetIdRaw && !telefone) {
      return res.json(400, { success: false, message: 'motoboy_id ou telefone são obrigatórios.' });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.json(400, { success: false, message: 'latitude e longitude são obrigatórios.' });
    }

    if (accuracy !== undefined && Number(accuracy) > 250) {
      return res.json(200, { success: true, message: 'Posição ignorada por baixa precisão do GPS.' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const spd = Number(speed || 0);

    if (isNaN(lat) || isNaN(lng)) {
      return res.json(400, { success: false, message: 'Latitude ou longitude inválidas.' });
    }

    const db = getDb();
    let motoboyIdNum = targetIdRaw ? Number(targetIdRaw) : null;

    if (!motoboyIdNum && telefone) {
      const telKey = String(telefone).trim();
      motoboyIdNum = deviceToMotoboyMap.get(telKey) || null;
      if (!motoboyIdNum) {
        const moto = await db.queryOne('SELECT id FROM motoboys WHERE telefone = ? OR telefone LIKE ?', [telKey, `%${telKey}%`]);
        if (moto) {
          motoboyIdNum = Number(moto.id);
          deviceToMotoboyMap.set(telKey, motoboyIdNum);
        }
      }
    }

    if (!motoboyIdNum) {
      return res.json(404, { success: false, message: 'Motoboy não identificado.' });
    }

    // Se o motoboy está parado (< 5m) e já atualizou nos últimos 40 segundos, economiza 100% das queries no Turso
    if (!devePersistirPosicaoMotoboy(motoboyIdNum, lat, lng)) {
      return res.json(200, {
        success: true,
        cached: true,
        message: 'Localização mantida (estacionário).',
        posicao: { latitude: lat, longitude: lng, speed: spd, timestamp: new Date().toISOString() }
      });
    }

    let idsParaAtualizar = [motoboyIdNum];
    if (motoboyIdNum === 4 || motoboyIdNum === 64) {
      idsParaAtualizar = [4, 64];
    } else if (motoboyIdNum === 5 || motoboyIdNum === 63) {
      idsParaAtualizar = [5, 63];
    }

    const nowTs = Date.now();
    for (const mId of idsParaAtualizar) {
      await db.execute(
        `UPDATE motoboys 
         SET latitude = ?, longitude = ?, velocidade = ?, ultima_atualizacao = DATETIME('now', '-3 hours') 
         WHERE id = ?`,
        [lat, lng, spd, mId]
      );
      lastMotoboyPos.set(mId, { lat, lng, spd, ts: nowTs });
      await gravarHistoricoRota(db, mId, lat, lng, spd);
    }

    return res.json(200, {
      success: true,
      message: 'Localização atualizada com sucesso!',
      posicao: { latitude: lat, longitude: lng, speed: spd, timestamp: new Date().toISOString() }
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar posição do motoboy:', error);
    return res.json(500, { success: false, message: 'Erro interno ao atualizar localização.', error: error.message });
  }
}

/**
 * Protocolo Traccar Client / OsmAnd HTTP Webhook
 * GET ou POST /api/traccar/location?id=TELEFONE&lat=LAT&lon=LON&speed=SPEED&hdop=HDOP&accuracy=ACC
 */
async function webhookTraccarClient(req, res) {
  try {
    const query = req.query || {};
    const body = req.body || {};

    const rawId = query.id || body.id || query.deviceId || body.deviceId || query.device_id || body.device_id || query.uniqueId || body.uniqueId;
    const rawLat = query.lat ?? query.latitude ?? body.lat ?? body.latitude;
    const rawLng = query.lon ?? query.lng ?? query.longitude ?? body.lon ?? body.lng ?? body.longitude;
    const rawAcc = query.accuracy ?? body.accuracy ?? query.hdop ?? body.hdop;
    
    if (rawAcc !== undefined && Number(rawAcc) > 200) {
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('OK');
    }

    let rawSpeed = query.speed ?? body.speed ?? query.velocidade ?? body.velocidade ?? 0;
    let speedKmH = Number(rawSpeed || 0);

    if (query.speed && !query.speed_unit) {
      const parsedSpd = Number(query.speed);
      if (!isNaN(parsedSpd) && parsedSpd < 100) {
        speedKmH = Math.round(parsedSpd * 1.852);
      }
    }

    if (!rawId || rawLat === undefined || rawLng === undefined) {
      return res.json(400, { success: false, message: 'Parâmetros id, lat e lon são obrigatórios.' });
    }

    const deviceId = String(rawId).trim();
    const lat = Number(rawLat);
    const lng = Number(rawLng);

    if (isNaN(lat) || isNaN(lng)) {
      return res.json(400, { success: false, message: 'Latitude ou longitude inválidas.' });
    }

    const db = getDb();
    let motoboyId = deviceToMotoboyMap.get(deviceId) || null;

    if (!motoboyId) {
      const motoboy = await db.queryOne(
        `SELECT id FROM motoboys WHERE telefone = ? OR traccar_device_id = ?`,
        [deviceId, deviceId]
      );
      if (motoboy) {
        motoboyId = Number(motoboy.id);
        deviceToMotoboyMap.set(deviceId, motoboyId);
      }
    }

    if (!motoboyId) {
      if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('MOTOBOY_NOT_FOUND');
    }

    if (!devePersistirPosicaoMotoboy(motoboyId, lat, lng)) {
      if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('OK');
    }

    await db.execute(
      `UPDATE motoboys 
       SET latitude = ?, longitude = ?, velocidade = ?, ultima_atualizacao = DATETIME('now', '-3 hours') 
       WHERE id = ?`,
      [lat, lng, speedKmH, motoboyId]
    );
    lastMotoboyPos.set(motoboyId, { lat, lng, spd: speedKmH, ts: Date.now() });

    await gravarHistoricoRota(db, motoboyId, lat, lng, speedKmH);

    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    return res.end('OK');
  } catch (error) {
    console.error('❌ Erro no webhook Traccar Client:', error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('SERVER_ERROR');
  }
}

module.exports = {
  atualizarPosicaoMotoboy,
  webhookTraccarClient
};
