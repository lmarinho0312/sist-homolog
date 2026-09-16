const config = require('../config/env');

/**
 * Serviço de comunicação com a API REST do Traccar Server
 */
async function fetchTraccarPositions() {
  const traccarUrl = config.TRACCAR_URL.replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${config.TRACCAR_USER}:${config.TRACCAR_PASS}`).toString('base64');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

    // Buscar lista de dispositivos no Traccar
    const devicesRes = await fetch(`${traccarUrl}/api/devices`, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
      signal: controller.signal
    });

    // Buscar lista de últimas posições no Traccar
    const positionsRes = await fetch(`${traccarUrl}/api/positions`, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!devicesRes.ok || !positionsRes.ok) {
      throw new Error(`Traccar respondeu com status ${devicesRes.status} / ${positionsRes.status}`);
    }

    const devices = await devicesRes.json();
    const positions = await positionsRes.json();

    // Mapear posições pelo uniqueId (telefone/identificador do motoboy)
    const positionMap = {};

    devices.forEach(device => {
      const pos = positions.find(p => p.deviceId === device.id);
      if (pos) {
        positionMap[device.uniqueId] = {
          latitude: pos.latitude,
          longitude: pos.longitude,
          speed: pos.speed || 0,
          fixTime: pos.fixTime || pos.serverTime || new Date().toISOString(),
          traccar_online: true
        };
      }
    });

    return {
      connected: true,
      positions: positionMap
    };
  } catch (error) {
    console.warn(`⚠️ API do Traccar Server em ${traccarUrl} não acessível (${error.message}). Utilizando modo de simulação dev.`);
    return {
      connected: false,
      positions: {}
    };
  }
}

/**
 * Retorna as coordenadas ativas do motoboy (reais do Traccar ou simuladas para dev)
 */
async function getPosicoesMotoboys(motoboys) {
  const traccarData = await fetchTraccarPositions();
  const result = {};

  // Ponto de referência inicial (Restaurante em São Paulo: Avenida Paulista / Centro)
  const baseLat = -23.5615;
  const baseLng = -46.6560;

  motoboys.forEach((m, index) => {
    const deviceId = m.traccar_device_id;
    const realPos = traccarData.positions[deviceId];

    if (traccarData.connected && realPos) {
      result[m.id] = {
        latitude: realPos.latitude,
        longitude: realPos.longitude,
        speed: realPos.speed,
        fixTime: realPos.fixTime,
        origem_gps: 'traccar_real'
      };
    } else {
      // Simulação realista com variação geográfica baseada no ID do motoboy para dev
      const offsetLat = (index + 1) * 0.008 * (index % 2 === 0 ? 1 : -1);
      const offsetLng = (index + 1) * 0.006 * (index % 2 === 0 ? -1 : 1);

      result[m.id] = {
        latitude: Number((baseLat + offsetLat).toFixed(6)),
        longitude: Number((baseLng + offsetLng).toFixed(6)),
        speed: 18 + index * 5,
        fixTime: new Date().toISOString(),
        origem_gps: 'simulado_dev'
      };
    }
  });

  return {
    traccar_online: traccarData.connected,
    posicoes: result
  };
}

module.exports = {
  fetchTraccarPositions,
  getPosicoesMotoboys
};
