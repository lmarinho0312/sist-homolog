const { getDb } = require('../database/db');

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
 * Filtro de Outliers: Verifica se a nova coordenada é um salto de ruído irreal
 */
async function eOutlierGps(db, pedidoId, newLat, newLng) {
  try {
    const ultimoPonto = await db.queryOne(
      `SELECT latitude, longitude, criado_em FROM pedido_rotas WHERE pedido_id = ? ORDER BY id DESC LIMIT 1`,
      [pedidoId]
    );
    if (!ultimoPonto) return false;

    const distMetros = calcularDistanciaMetros(ultimoPonto.latitude, ultimoPonto.longitude, newLat, newLng);

    // Ignorar pontos idênticos ou com deslocamento insignificante (< 4 metros)
    if (distMetros < 4) return true;

    // Calcular tempo decorrido
    let dtSeconds = 5;
    if (ultimoPonto.criado_em) {
      const t1 = new Date(ultimoPonto.criado_em.includes('T') ? ultimoPonto.criado_em : ultimoPonto.criado_em.replace(' ', 'T') + 'Z').getTime();
      const t2 = Date.now();
      dtSeconds = Math.max(1, (t2 - t1) / 1000);
    }

    const velocidadeImpliedKmH = (distMetros / dtSeconds) * 3.6;

    // Se o ponto deu um salto instantâneo de mais de 70 metros a mais de 90 km/h na cidade, descarte o ruído
    if (distMetros > 70 && velocidadeImpliedKmH > 90) {
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
  try {
    const pedidosAtivos = await db.query(
      `SELECT id FROM pedidos WHERE motoboy_id = ? AND status = 'em_rota'`,
      [motoboyId]
    );

    if (pedidosAtivos && pedidosAtivos.length > 0) {
      for (const p of pedidosAtivos) {
        const descarte = await eOutlierGps(db, p.id, lat, lng);
        if (!descarte) {
          await db.execute(
            `INSERT INTO pedido_rotas (pedido_id, motoboy_id, latitude, longitude, velocidade, criado_em) 
             VALUES (?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
            [p.id, motoboyId, lat, lng, spd]
          );
        }
      }
    }
  } catch (err) {
    console.error('⚠️ Erro ao gravar ponto de histórico da rota:', err.message);
  }
}

/**
 * Endpoint para o Web App do Motoboy enviar sua localização GPS em tempo real (HTML5 Geolocation)
 * POST /api/motoboy/posicao
 * Body: { motoboy_id, latitude, longitude, speed, accuracy }
 */
async function atualizarPosicaoMotoboy(req, res) {
  try {
    const { motoboy_id, latitude, longitude, speed, accuracy } = req.body || {};

    if (!motoboy_id || latitude === undefined || longitude === undefined) {
      return res.json(400, { success: false, message: 'motoboy_id, latitude e longitude são obrigatórios.' });
    }

    // FILTRO DE ACURÁCIA (LAYER 1): Descartar leituras de GPS do navegador com erro de precisão > 35m
    if (accuracy !== undefined && Number(accuracy) > 35) {
      console.warn(`⚠️ Posição ignorada por baixa acurácia do celular (${accuracy}m)`);
      return res.json(200, { success: true, message: 'Posição ignorada por baixa precisão do GPS.' });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const spd = Number(speed || 0);

    if (isNaN(lat) || isNaN(lng)) {
      return res.json(400, { success: false, message: 'Latitude ou longitude inválidas.' });
    }

    const db = getDb();
    const motoboyIdNum = Number(motoboy_id);
    
    // Atualizar última posição do motoboy
    const result = await db.execute(
      `UPDATE motoboys 
       SET latitude = ?, longitude = ?, velocidade = ?, ultima_atualizacao = DATETIME('now', '-3 hours') 
       WHERE id = ?`,
      [lat, lng, spd, motoboyIdNum]
    );

    if (result.changes === 0) {
      return res.json(404, { success: false, message: 'Motoboy não encontrado.' });
    }

    await gravarHistoricoRota(db, motoboyIdNum, lat, lng, spd);

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
    
    // FILTRO DE ACURÁCIA (LAYER 1): Descartar leituras do Traccar Client se a acurácia/hdop estiver muito ruim
    if (rawAcc !== undefined && Number(rawAcc) > 35) {
      console.warn(`⚠️ Traccar ping ignorado por acurácia ruim (${rawAcc}m)`);
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

    const motoboy = await db.queryOne(
      `SELECT id FROM motoboys WHERE telefone = ? OR traccar_device_id = ?`,
      [deviceId, deviceId]
    );

    if (!motoboy) {
      if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('MOTOBOY_NOT_FOUND');
    }

    await db.execute(
      `UPDATE motoboys 
       SET latitude = ?, longitude = ?, velocidade = ?, ultima_atualizacao = DATETIME('now', '-3 hours') 
       WHERE id = ?`,
      [lat, lng, speedKmH, motoboy.id]
    );

    await gravarHistoricoRota(db, motoboy.id, lat, lng, speedKmH);

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
