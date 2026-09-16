const { getDb } = require('../database/db');
const { getPosicoesMotoboys } = require('../services/traccarService');
const { expirarPedidosPendentesDiasAnteriores } = require('./pedidosController');
const { obterTaxaRepasse, obterNomeBairroCanonica } = require('../utils/rateResolver');

async function getPosicoesMapa(req, res) {
  try {
    const db = getDb();
    await expirarPedidosPendentesDiasAnteriores(db);

    // Buscar motoboys incluindo suas coordenadas gravadas em tempo real
    const motoboys = await db.query(
      `SELECT id, nome, telefone, traccar_device_id, latitude, longitude, velocidade, ultima_atualizacao FROM motoboys`
    );

    if (!motoboys || motoboys.length === 0) {
      return res.json(200, { success: true, traccar_online: false, motoboys: [] });
    }

    const pedidosEmRota = await db.query(
      `SELECT id, numero_pedido, motoboy_id, data_inicio,
              ROUND((julianday('now') - julianday(data_inicio)) * 1440) as minutos_em_rota
       FROM pedidos 
       WHERE status = 'em_rota' 
         AND DATE(COALESCE(data_inicio, criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
       ORDER BY data_inicio ASC`
    );

    const pedidosPorMotoboy = {};
    pedidosEmRota.forEach(p => {
      if (!pedidosPorMotoboy[p.motoboy_id]) {
        pedidosPorMotoboy[p.motoboy_id] = [];
      }
      pedidosPorMotoboy[p.motoboy_id].push({
        id: p.id,
        numero_pedido: p.numero_pedido,
        minutos_em_rota: p.minutos_em_rota || 0,
        data_inicio: p.data_inicio
      });
    });

    // Tentar obter também do servidor Traccar se configurado
    const gpsInfo = await getPosicoesMotoboys(motoboys);

    let temGpsRealEmAlgumMotoboy = false;

    const resultado = motoboys.map((m, index) => {
      const pedidosDoMotoboy = pedidosPorMotoboy[m.id] || [];

      let lat = 0;
      let lng = 0;
      let speed = 0;
      let fixTime = null;
      let origemGps = 'desconhecido';

      // 1. Prioridade MAXIMA: Posição GPS Real enviada pelo Web App do Motoboy ou Webhook Traccar Client
      if (m.latitude !== null && m.latitude !== undefined && m.longitude !== null && m.longitude !== undefined) {
        lat = Number(m.latitude);
        lng = Number(m.longitude);
        speed = Number(m.velocidade || 0);
        fixTime = m.ultima_atualizacao || new Date().toISOString();
        origemGps = 'gps_real';
        temGpsRealEmAlgumMotoboy = true;
      }
      // 2. Segunda prioridade: Traccar Server API
      else if (gpsInfo.posicoes[m.id] && gpsInfo.posicoes[m.id].origem_gps === 'traccar_real') {
        const pos = gpsInfo.posicoes[m.id];
        lat = pos.latitude;
        lng = pos.longitude;
        speed = pos.speed;
        fixTime = pos.fixTime;
        origemGps = 'traccar_real';
        temGpsRealEmAlgumMotoboy = true;
      }
      // 3. Fallback: Posição simulada realista se nenhum GPS real foi enviado ainda
      else {
        const posSimulada = gpsInfo.posicoes[m.id];
        lat = posSimulada ? posSimulada.latitude : -23.5615 + (index * 0.005);
        lng = posSimulada ? posSimulada.longitude : -46.6560 + (index * 0.005);
        speed = posSimulada ? posSimulada.speed : 0;
        fixTime = new Date().toISOString();
        origemGps = 'simulado_dev';
      }

      return {
        motoboy_id: m.id,
        nome: m.nome,
        telefone: m.telefone,
        traccar_device_id: m.traccar_device_id,
        latitude: lat,
        longitude: lng,
        speed: speed,
        ultima_atualizacao: fixTime,
        origem_gps: origemGps,
        status_motoboy: pedidosDoMotoboy.length > 0 ? 'em_rota' : 'disponivel',
        qtd_pedidos: pedidosDoMotoboy.length,
        pedidos_numeros: pedidosDoMotoboy.map(p => p.numero_pedido),
        pedidos_detalhes: pedidosDoMotoboy
      };
    });

    return res.json(200, {
      success: true,
      timestamp: new Date().toISOString(),
      traccar_online: temGpsRealEmAlgumMotoboy || gpsInfo.traccar_online,
      total_motoboys: motoboys.length,
      total_pedidos_em_rota: pedidosEmRota.length,
      data: resultado
    });
  } catch (error) {
    console.error('❌ Erro ao obter posições para o mapa:', error);
    return res.json(500, { success: false, message: 'Erro interno ao consultar mapa da cozinha.', error: error.message });
  }
}

/**
 * Estatísticas resumidas da operação para os KPIs do Painel da Cozinha
 * GET /api/admin/stats (Resumo das entregas de HOJE)
 */
async function getDashboardStats(req, res) {
  try {
    const db = getDb();
    await expirarPedidosPendentesDiasAnteriores(db);

    const [aguardandoRes, emRotaRes, entreguesRes, totalRes, faturamentoRes, motoboysCountRes] = await Promise.all([
      db.queryOne(`
        SELECT COUNT(*) as count FROM pedidos 
        WHERE (status IN ('disponivel', 'aguardando_retirada', 'pronto', 'em_preparo') OR status IS NULL) 
          AND motoboy_id IS NULL 
          AND status NOT IN ('entregue', 'expirado', 'cancelado')
          AND DATE(COALESCE(criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
      `),
      db.queryOne(`
        SELECT COUNT(*) as count FROM pedidos 
        WHERE status = 'em_rota'
          AND DATE(COALESCE(data_inicio, criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
      `),
      db.queryOne(`
        SELECT COUNT(*) as count FROM pedidos 
        WHERE status = 'entregue'
          AND DATE(COALESCE(data_fim, data_inicio, criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
      `),
      db.queryOne(`
        SELECT COUNT(*) as count FROM pedidos
        WHERE DATE(COALESCE(criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
          AND status NOT IN ('expirado', 'cancelado')
      `),
      db.queryOne(`
        SELECT COALESCE(SUM(taxa_entrega), 0) as total_taxas FROM pedidos 
        WHERE status = 'entregue'
          AND DATE(COALESCE(data_fim, data_inicio, criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
      `),
      db.queryOne(`SELECT COUNT(*) as count FROM motoboys`)
    ]);

    const aguardando = Number(aguardandoRes?.count || 0);
    const emRota = Number(emRotaRes?.count || 0);
    const entregues = Number(entreguesRes?.count || 0);
    const total = Number(totalRes?.count || 0);
    const faturamentoTaxas = Number(faturamentoRes?.total_taxas || 0);
    const totalMotoboys = Number(motoboysCountRes?.count || 0);

    // Estimativa de faturamento operacional do dia (ticket médio + taxas)
    const faturamentoEstimado = entregues > 0 
      ? (entregues * 45.80) + faturamentoTaxas 
      : 0;

    return res.json(200, {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        pedidos_aguardando: aguardando,
        pedidos_em_preparo: aguardando,
        pedidos_em_rota: emRota,
        pedidos_entregues: entregues,
        total_pedidos: total,
        faturamento_hoje: Number(faturamentoEstimado.toFixed(2)),
        total_motoboys: totalMotoboys
      }
    });
  } catch (error) {
    console.error('❌ Erro ao obter estatísticas:', error);
    return res.json(500, { success: false, message: 'Erro ao obter estatísticas do dashboard.', error: error.message });
  }
}

/**
 * Listagem completa e flexível de pedidos para o painel da cozinha (Lista e Kanban)
 * GET /api/admin/pedidos?status=...&busca=...&data=hoje
 */
async function listarTodosPedidos(req, res) {
  try {
    const db = getDb();
    await expirarPedidosPendentesDiasAnteriores(db);

    const { status, busca, data = 'hoje', incluir_expirados } = req.query || {};

    let query = `
      SELECT p.id, p.numero_pedido, p.status, p.origem, p.grupo, p.pedido_id_origem,
             p.cliente, p.endereco, p.bairro, p.taxa_entrega, p.telefone_cliente,
             p.localizador,
             p.texto_bruto, p.data_inicio, p.data_fim, p.criado_em,
             m.id as motoboy_id, m.nome as motoboy_nome, m.telefone as motoboy_telefone, m.grupo as motoboy_grupo,
             CASE 
               WHEN p.status = 'em_rota' AND p.data_inicio IS NOT NULL THEN
                 ROUND((julianday(DATETIME('now', '-3 hours')) - julianday(p.data_inicio)) * 1440)
               WHEN p.status IN ('disponivel', 'aguardando_retirada', 'pronto', 'em_preparo') OR p.status IS NULL THEN
                 ROUND((julianday(DATETIME('now', '-3 hours')) - julianday(COALESCE(p.criado_em, DATETIME('now', '-3 hours')))) * 1440)
               WHEN p.status = 'entregue' AND p.data_fim IS NOT NULL AND p.data_inicio IS NOT NULL THEN
                 ROUND((julianday(p.data_fim) - julianday(p.data_inicio)) * 1440)
               ELSE 0
             END as tempo_decorrido_minutos,
             (SELECT COUNT(*) FROM pedido_rotas pr WHERE pr.pedido_id = p.id) as total_pontos_gps
      FROM pedidos p
      LEFT JOIN motoboys m ON p.motoboy_id = m.id
    `;

    const conditions = [];
    const params = [];

    const isBuscaAtiva = Boolean(busca && busca.trim() !== '');

    if (isBuscaAtiva) {
      // Quando o operador busca por texto livre (número, cliente, endereço), busca sem restrição estrita de data
      const termo = `%${busca.trim()}%`;
      conditions.push(`(p.numero_pedido LIKE ? OR p.cliente LIKE ? OR p.endereco LIKE ? OR p.bairro LIKE ? OR p.localizador LIKE ? OR p.telefone_cliente LIKE ? OR m.nome LIKE ?)`);
      params.push(termo, termo, termo, termo, termo, termo, termo);
    } else {
      // Regra de virada de data: por padrão no painel ativo da cozinha, apenas pedidos de HOJE são exibidos
      if (data === 'hoje') {
        conditions.push(`DATE(COALESCE(p.criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))`);
      } else if (data && data !== 'todos' && data !== 'all') {
        conditions.push(`DATE(COALESCE(p.criado_em, DATETIME('now', '-3 hours'))) = ?`);
        params.push(data);
      }

      // Ignora pedidos cancelados ou expirados na visualização operacional normal
      if (incluir_expirados !== 'true') {
        conditions.push(`p.status NOT IN ('expirado', 'cancelado')`);
      }
    }

    if (status && status !== 'todos' && status !== 'all') {
      if (status === 'aguardando' || status === 'disponivel' || status === 'balcao' || status === 'pronto') {
        conditions.push(`(p.status IN ('disponivel', 'aguardando_retirada', 'pronto', 'em_preparo') OR status IS NULL) AND p.motoboy_id IS NULL AND (p.status != 'entregue' OR p.status IS NULL)`);
      } else {
        conditions.push(`p.status = ?`);
        params.push(status);
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY p.id DESC`;

    const pedidos = await db.query(query, params);

    return res.json(200, {
      success: true,
      total: pedidos.length,
      pedidos: pedidos.map(p => {
        const grupoEfetivo = (p.grupo === 'SPEED' || p.motoboy_grupo === 'SPEED') ? 'SPEED' : (p.grupo === 'VELOZ' || p.motoboy_grupo === 'VELOZ' ? 'VELOZ' : 'VELOZ');
        const repasse = obterTaxaRepasse(p.bairro, p.endereco, p.texto_bruto, grupoEfetivo);
        const bairroFormatado = obterNomeBairroCanonica(p.bairro, p.endereco, p.texto_bruto);
        return {
          id: p.id,
          numero_pedido: p.numero_pedido,
          status: p.status,
          origem: p.origem || 'MANUAL',
          grupo: p.grupo || null,
          cliente: p.cliente || 'Cliente Balcão',
          endereco: p.endereco || 'Retirada no balcão',
          bairro: bairroFormatado,
          taxa_repasse: repasse,
          taxa_entrega: repasse, // Reflete a taxa oficial por bairro da Ao Ponto
          telefone_cliente: p.telefone_cliente || '',
          localizador: p.localizador || '',
          texto_bruto: p.texto_bruto || '',
          data_inicio: p.data_inicio,
          data_fim: p.data_fim,
          criado_em: p.criado_em,
          tempo_decorrido_minutos: Math.max(0, Math.round(Number(p.tempo_decorrido_minutos || 0))),
          motoboy: p.motoboy_id ? {
            id: p.motoboy_id,
            nome: p.motoboy_nome,
            telefone: p.motoboy_telefone,
            grupo: p.motoboy_grupo || 'VELOZ'
          } : null,
          total_pontos_gps: Number(p.total_pontos_gps || 0)
        };
      })
    });
  } catch (error) {
    console.error('❌ Erro ao listar todos os pedidos:', error);
    return res.json(500, { success: false, message: 'Erro ao listar pedidos.', error: error.message });
  }
}

/**
 * Listar motoboys com status detalhado
 * GET /api/admin/motoboys
 */
async function listarMotoboysAdmin(req, res) {
  try {
    const db = getDb();
    const motoboys = await db.query(
      `SELECT id, nome, telefone, traccar_device_id, latitude, longitude, velocidade, ultima_atualizacao, criado_em, grupo FROM motoboys ORDER BY id ASC`
    );

    const pedidosAtivos = await db.query(
      `SELECT id, numero_pedido, motoboy_id, data_inicio, cliente, endereco FROM pedidos WHERE status = 'em_rota'`
    );

    const pedidosPorMotoboy = {};
    pedidosAtivos.forEach(p => {
      if (!pedidosPorMotoboy[p.motoboy_id]) pedidosPorMotoboy[p.motoboy_id] = [];
      pedidosPorMotoboy[p.motoboy_id].push(p);
    });

    const resultado = motoboys.map(m => {
      const pedidos = pedidosPorMotoboy[m.id] || [];
      const hasRecentGps = m.ultima_atualizacao && (new Date() - new Date(m.ultima_atualizacao.replace(' ', 'T') + 'Z') < 1000 * 60 * 15);
      
      let statusCalculado = 'disponivel';
      if (pedidos.length > 0) {
        statusCalculado = 'em_rota';
      } else if (!hasRecentGps && m.latitude === null) {
        statusCalculado = 'offline';
      }

      return {
        id: m.id,
        nome: m.nome,
        telefone: m.telefone,
        grupo: m.grupo || 'VELOZ',
        traccar_device_id: m.traccar_device_id,
        latitude: m.latitude,
        longitude: m.longitude,
        velocidade: Number(m.velocidade || 0),
        ultima_atualizacao: m.ultima_atualizacao,
        status: statusCalculado,
        qtd_pedidos: pedidos.length,
        pedidos_em_rota: pedidos
      };
    });

    return res.json(200, {
      success: true,
      total: resultado.length,
      motoboys: resultado
    });
  } catch (error) {
    console.error('❌ Erro ao listar motoboys:', error);
    return res.json(500, { success: false, message: 'Erro ao listar motoboys.', error: error.message });
  }
}

/**
 * Fechamento de Entregas e Taxas a Pagar por Período
 * GET /api/admin/fechamento?periodo=hoje|ontem|semana|mes|todos&motoboy_id=todos|<id>
 */
async function obterFechamentoEntregas(req, res) {
  try {
    const db = getDb();
    const { periodo = 'hoje', motoboy_id, grupo = 'todos', data_inicio, data_fim } = req.query || {};

    let dataFiltro = '';
    const params = [];

    switch (periodo) {
      case 'hoje':
        dataFiltro = `AND DATE(COALESCE(p.data_fim, p.data_inicio, p.criado_em)) = DATE(DATETIME('now', '-3 hours'))`;
        break;
      case 'ontem':
        dataFiltro = `AND DATE(COALESCE(p.data_fim, p.data_inicio, p.criado_em)) = DATE(DATETIME('now', '-3 hours', '-1 day'))`;
        break;
      case 'semana':
        dataFiltro = `AND DATE(COALESCE(p.data_fim, p.data_inicio, p.criado_em)) >= DATE(DATETIME('now', '-3 hours', 'weekday 0', '-7 days'))`;
        break;
      case 'mes':
        dataFiltro = `AND strftime('%Y-%m', COALESCE(p.data_fim, p.data_inicio, p.criado_em)) = strftime('%Y-%m', DATETIME('now', '-3 hours'))`;
        break;
      case 'personalizado': {
        let dtIni = String(data_inicio || '').trim();
        let dtFim = String(data_fim || '').trim();
        if (dtIni && dtFim) {
          if (dtIni > dtFim) {
            const temp = dtIni;
            dtIni = dtFim;
            dtFim = temp;
          }
          dataFiltro = `AND DATE(COALESCE(p.data_fim, p.data_inicio, p.criado_em)) BETWEEN ? AND ?`;
          params.push(dtIni, dtFim);
        } else if (dtIni) {
          dataFiltro = `AND DATE(COALESCE(p.data_fim, p.data_inicio, p.criado_em)) >= ?`;
          params.push(dtIni);
        } else if (dtFim) {
          dataFiltro = `AND DATE(COALESCE(p.data_fim, p.data_inicio, p.criado_em)) <= ?`;
          params.push(dtFim);
        }
        break;
      }
      case 'todos':
      default:
        dataFiltro = '';
        break;
    }

    let motoboyFiltro = '';
    if (motoboy_id && motoboy_id !== 'todos' && !isNaN(Number(motoboy_id))) {
      motoboyFiltro = `AND p.motoboy_id = ?`;
      params.push(Number(motoboy_id));
    }

    let grupoFiltro = '';
    const cleanGrupo = String(grupo).toUpperCase();
    if (cleanGrupo === 'VELOZ' || cleanGrupo === 'SPEED') {
      grupoFiltro = `AND (m.grupo = ? OR p.grupo = ?)`;
      params.push(cleanGrupo, cleanGrupo);
    }

    const entregas = await db.query(`
      SELECT 
        p.id,
        p.numero_pedido,
        p.grupo as pedido_grupo,
        p.cliente,
        p.endereco,
        p.bairro,
        p.origem,
        p.data_inicio,
        p.data_fim,
        p.motoboy_id,
        p.texto_bruto,
        m.nome as motoboy_nome,
        m.telefone as motoboy_telefone,
        m.grupo as motoboy_grupo
      FROM pedidos p
      LEFT JOIN motoboys m ON p.motoboy_id = m.id
      WHERE p.status = 'entregue'
        AND p.motoboy_id IS NOT NULL
        ${dataFiltro}
        ${motoboyFiltro}
        ${grupoFiltro}
      ORDER BY p.data_fim DESC
    `, params);

    const porMotoboy = {};
    let totalGeralEntregas = 0;
    let totalGeralTaxas = 0;

    const entregasDetalhadas = entregas.map(e => {
      totalGeralEntregas++;
      const grupoMotoboy = (e.motoboy_grupo || e.pedido_grupo || 'VELOZ').toUpperCase();
      const taxaEfetiva = obterTaxaRepasse(e.bairro, e.endereco, e.texto_bruto, grupoMotoboy);
      const bairroNome = obterNomeBairroCanonica(e.bairro, e.endereco, e.texto_bruto) || e.bairro;
      totalGeralTaxas += taxaEfetiva;

      if (!porMotoboy[e.motoboy_id]) {
        porMotoboy[e.motoboy_id] = {
          motoboy_id: e.motoboy_id,
          nome: e.motoboy_nome,
          telefone: e.motoboy_telefone,
          grupo: e.motoboy_grupo || 'VELOZ',
          total_entregas: 0,
          total_taxas: 0,
          entregas: []
        };
      }

      porMotoboy[e.motoboy_id].total_entregas++;
      porMotoboy[e.motoboy_id].total_taxas += taxaEfetiva;
      porMotoboy[e.motoboy_id].entregas.push({
        id: e.id,
        numero_pedido: e.numero_pedido,
        grupo: e.pedido_grupo || e.motoboy_grupo || 'VELOZ',
        cliente: e.cliente,
        endereco: e.endereco,
        bairro: bairroNome,
        origem: e.origem,
        data_inicio: e.data_inicio,
        data_fim: e.data_fim,
        taxa_repasse: taxaEfetiva
      });

      return {
        id: e.id,
        numero_pedido: e.numero_pedido,
        grupo: e.pedido_grupo || e.motoboy_grupo || 'VELOZ',
        cliente: e.cliente,
        endereco: e.endereco,
        bairro: bairroNome,
        origem: e.origem,
        data_inicio: e.data_inicio,
        data_fim: e.data_fim,
        motoboy: { id: e.motoboy_id, nome: e.motoboy_nome, telefone: e.motoboy_telefone, grupo: e.motoboy_grupo || 'VELOZ' },
        taxa_repasse: taxaEfetiva
      };
    });

    const resumoPorMotoboy = Object.values(porMotoboy).map(m => ({
      ...m,
      total_taxas: Number(m.total_taxas.toFixed(2))
    }));

    return res.json(200, {
      success: true,
      periodo,
      grupo_filtro: cleanGrupo === 'VELOZ' || cleanGrupo === 'SPEED' ? cleanGrupo : 'todos',
      taxa_padrao_sem_bairro: 10.00,
      kpis: {
        total_entregas: totalGeralEntregas,
        total_taxas: Number(totalGeralTaxas.toFixed(2)),
        media_taxa: totalGeralEntregas > 0 ? Number((totalGeralTaxas / totalGeralEntregas).toFixed(2)) : 0,
        entregadores_ativos: resumoPorMotoboy.length
      },
      por_motoboy: resumoPorMotoboy,
      entregas_detalhadas: entregasDetalhadas
    });
  } catch (error) {
    console.error('❌ Erro ao obter fechamento de entregas:', error);
    return res.json(500, { success: false, message: 'Erro ao obter fechamento de entregas.', error: error.message });
  }
}

/**
 * Criação manual de pedido diretamente pelo Painel Admin
 * POST /api/admin/pedidos/manual
 */
async function criarPedidoManual(req, res) {
  try {
    const { numero_pedido, origem, grupo, cliente, endereco, bairro, taxa_entrega, telefone_cliente, localizador, itens, observacoes } = req.body || {};

    if (!numero_pedido) {
      return res.json(400, { success: false, message: 'Número do pedido é obrigatório.' });
    }

    const cleanOrigem = (origem || 'MANUAL').trim().toUpperCase();
    const cleanPedidoId = String(numero_pedido).trim();
    const cleanGrupo = grupo ? String(grupo).trim().toUpperCase() : null;
    const cleanCliente = cliente ? String(cliente).trim() : 'Cliente';
    const cleanEndereco = endereco ? String(endereco).trim() : null;
    let cleanBairro = bairro ? String(bairro).trim() : null;
    const cleanTelefone = telefone_cliente ? String(telefone_cliente).trim() : null;
    const cleanLocalizador = localizador ? String(localizador).trim() : null;

    let textoBrutoParts = [];
    if (itens) textoBrutoParts.push(String(itens).trim());
    if (observacoes) textoBrutoParts.push(`Obs: ${String(observacoes).trim()}`);
    const cleanTextoBruto = textoBrutoParts.length > 0 ? textoBrutoParts.join('\n') : null;

    if (cleanBairro) {
      cleanBairro = obterNomeBairroCanonica(cleanBairro, cleanEndereco, cleanTextoBruto) || cleanBairro;
    }
    const taxa = !isNaN(Number(taxa_entrega)) && Number(taxa_entrega) > 0
      ? Number(taxa_entrega)
      : obterTaxaRepasse(cleanBairro, cleanEndereco, cleanTextoBruto, cleanGrupo || 'VELOZ');

    const db = getDb();

    const result = await db.execute(
      `INSERT INTO pedidos 
       (numero_pedido, motoboy_id, status, grupo, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, localizador, texto_bruto, criado_em)
       VALUES (?, NULL, 'disponivel', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
      [cleanPedidoId, cleanGrupo, cleanOrigem, cleanPedidoId, cleanCliente, cleanEndereco, cleanBairro, taxa, cleanTelefone, cleanLocalizador, cleanTextoBruto]
    );

    const novoPedidoId = Number(result.lastInsertRowid);
    const novoPedido = await db.queryOne(`SELECT * FROM pedidos WHERE id = ?`, [novoPedidoId]);

    return res.json(201, {
      success: true,
      message: `Pedido #${cleanPedidoId} cadastrado com sucesso!`,
      pedido: novoPedido
    });
  } catch (error) {
    console.error('❌ Erro ao criar pedido manual:', error);
    return res.json(500, { success: false, message: 'Erro ao cadastrar pedido manual.', error: error.message });
  }
}

/**
 * Ação Administrativa: Limpeza forçada manual de pedidos pendentes de datas anteriores
 * POST /api/admin/pedidos/limpar-pendentes-antigos
 */
async function limparPedidosPendentesAntigos(req, res) {
  try {
    const db = getDb();
    const count = await expirarPedidosPendentesDiasAnteriores(db);
    return res.json(200, {
      success: true,
      count,
      message: count > 0 
        ? `${count} entrega(s) pendente(s) de datas anteriores foram ignoradas/expiradas com sucesso!`
        : 'Nenhum pedido pendente de datas anteriores acumulado no momento.'
    });
  } catch (error) {
    console.error('❌ Erro ao limpar pendentes antigos:', error);
    return res.json(500, { success: false, message: 'Erro ao limpar entregas pendentes.', error: error.message });
  }
}

// ── SEGURANÇA & GESTÃO DE MOTOBOYS (PROTEGIDO POR SENHA) ─────────────────────
const SENHA_GESTAO_MOTOBOYS = 'boijoaocarnes01';

/**
 * Validação da senha de acesso à aba de gestão de entregadores
 * POST /api/admin/motoboys/verificar-senha
 */
async function verificarSenhaMotoboys(req, res) {
  try {
    const { senha } = req.body || {};
    if (!senha || String(senha).trim() !== SENHA_GESTAO_MOTOBOYS) {
      return res.json(401, { success: false, message: 'Senha incorreta para gestão de entregadores.' });
    }
    return res.json(200, { success: true, message: 'Acesso autorizado!' });
  } catch (error) {
    return res.json(500, { success: false, message: 'Erro ao validar senha.', error: error.message });
  }
}

/**
 * Atualizar dados cadastrais e grupo do motoboy (VELOZ ou SPEED)
 * POST /api/admin/motoboys/atualizar
 */
async function atualizarMotoboy(req, res) {
  try {
    const { id, nome, telefone, grupo, traccar_device_id, senha, senha_admin } = req.body || {};
    if (!id) {
      return res.json(400, { success: false, message: 'ID do entregador é obrigatório.' });
    }
    if (senha_admin && String(senha_admin).trim() !== SENHA_GESTAO_MOTOBOYS) {
      return res.json(401, { success: false, message: 'Senha de administrador inválida.' });
    }

    const motoboyId = Number(id);
    const db = getDb();
    const motoboyAtual = await db.queryOne('SELECT * FROM motoboys WHERE id = ?', [motoboyId]);
    if (!motoboyAtual) {
      return res.json(404, { success: false, message: 'Entregador não encontrado.' });
    }

    let cleanGrupo = grupo ? String(grupo).trim().toUpperCase() : motoboyAtual.grupo || 'VELOZ';
    if (cleanGrupo !== 'VELOZ' && cleanGrupo !== 'SPEED') {
      cleanGrupo = 'VELOZ';
    }

    const cleanNome = nome ? String(nome).trim() : motoboyAtual.nome;
    const cleanTelefone = telefone ? String(telefone).trim().replace(/\D/g, '') : motoboyAtual.telefone;
    const cleanDeviceId = traccar_device_id ? String(traccar_device_id).trim() : motoboyAtual.traccar_device_id;

    let updateSql = `UPDATE motoboys SET nome = ?, telefone = ?, grupo = ?, traccar_device_id = ?`;
    const params = [cleanNome, cleanTelefone, cleanGrupo, cleanDeviceId];

    if (senha && String(senha).trim().length > 0) {
      const { hashPassword } = require('../utils/password');
      updateSql += `, senha = ?`;
      params.push(hashPassword(String(senha).trim()));
    }

    updateSql += ` WHERE id = ?`;
    params.push(motoboyId);

    await db.execute(updateSql, params);

    const motoboyAtualizado = await db.queryOne(
      'SELECT id, nome, telefone, traccar_device_id, grupo, latitude, longitude, velocidade, ultima_atualizacao FROM motoboys WHERE id = ?',
      [motoboyId]
    );

    return res.json(200, {
      success: true,
      message: `Entregador "${cleanNome}" atualizado com sucesso! (Grupo: ${cleanGrupo})`,
      motoboy: motoboyAtualizado
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar motoboy:', error);
    return res.json(500, { success: false, message: 'Erro ao atualizar dados do entregador.', error: error.message });
  }
}

/**
 * Cadastrar novo motoboy diretamente pelo Painel Admin
 * POST /api/admin/motoboys/cadastrar
 */
async function cadastrarMotoboyAdmin(req, res) {
  try {
    const { nome, telefone, grupo, traccar_device_id, senha, senha_admin } = req.body || {};
    if (senha_admin && String(senha_admin).trim() !== SENHA_GESTAO_MOTOBOYS) {
      return res.json(401, { success: false, message: 'Senha de administrador inválida.' });
    }
    if (!nome || !telefone || !senha) {
      return res.json(400, { success: false, message: 'Nome, telefone e senha de acesso são obrigatórios.' });
    }

    const cleanTelefone = String(telefone).trim().replace(/\D/g, '');
    let cleanGrupo = grupo ? String(grupo).trim().toUpperCase() : 'VELOZ';
    if (cleanGrupo !== 'VELOZ' && cleanGrupo !== 'SPEED') cleanGrupo = 'VELOZ';
    const cleanDeviceId = traccar_device_id ? String(traccar_device_id).trim() : cleanTelefone;

    const db = getDb();
    const existente = await db.queryOne('SELECT id FROM motoboys WHERE telefone = ? OR traccar_device_id = ?', [cleanTelefone, cleanDeviceId]);
    if (existente) {
      return res.json(400, { success: false, message: 'Já existe um entregador cadastrado com este telefone ou ID.' });
    }

    const { hashPassword } = require('../utils/password');
    const hashedPassword = hashPassword(String(senha).trim());

    const result = await db.execute(
      `INSERT INTO motoboys (nome, telefone, senha, traccar_device_id, grupo) VALUES (?, ?, ?, ?, ?)`,
      [String(nome).trim(), cleanTelefone, hashedPassword, cleanDeviceId, cleanGrupo]
    );

    const novoId = Number(result.lastInsertRowid);
    const novoMotoboy = await db.queryOne(
      'SELECT id, nome, telefone, traccar_device_id, grupo, criado_em FROM motoboys WHERE id = ?',
      [novoId]
    );

    return res.json(201, {
      success: true,
      message: `Entregador "${novoMotoboy.nome}" cadastrado com sucesso no grupo ${cleanGrupo}!`,
      motoboy: novoMotoboy
    });
  } catch (error) {
    console.error('❌ Erro ao cadastrar motoboy pelo admin:', error);
    return res.json(500, { success: false, message: 'Erro ao cadastrar entregador.', error: error.message });
  }
}

/**
 * Obter tabelas de taxas de ambos os grupos (VELOZ e SPEED)
 * GET /api/admin/taxas
 */
async function obterTaxasBairros(req, res) {
  try {
    const db = getDb();
    const [taxasVeloz, taxasSpeed] = await Promise.all([
      db.query('SELECT id, bairro, taxa FROM taxa_bairro ORDER BY bairro ASC'),
      db.query('SELECT id, bairro, taxa FROM taxa_bairro_speed ORDER BY bairro ASC')
    ]);
    return res.json(200, {
      success: true,
      taxas_veloz: taxasVeloz,
      taxas_speed: taxasSpeed
    });
  } catch (error) {
    console.error('❌ Erro ao listar taxas de bairros:', error);
    return res.json(500, { success: false, message: 'Erro ao consultar taxas.', error: error.message });
  }
}

/**
 * Atualizar taxa de bairro em uma das tabelas (taxa_bairro para VELOZ, taxa_bairro_speed para SPEED)
 * POST /api/admin/taxas/atualizar
 */
async function atualizarTaxaBairro(req, res) {
  try {
    const { grupo, bairro, taxa, senha_admin } = req.body || {};
    if (senha_admin && String(senha_admin).trim() !== SENHA_GESTAO_MOTOBOYS) {
      return res.json(401, { success: false, message: 'Senha de administrador inválida.' });
    }
    if (!bairro || taxa === undefined || isNaN(Number(taxa))) {
      return res.json(400, { success: false, message: 'Bairro e taxa válida são obrigatórios.' });
    }

    const cleanGrupo = (grupo || '').toUpperCase() === 'SPEED' ? 'SPEED' : 'VELOZ';
    const tabela = cleanGrupo === 'SPEED' ? 'taxa_bairro_speed' : 'taxa_bairro';
    const cleanBairro = String(bairro).trim();
    const cleanTaxa = Number(taxa);

    const db = getDb();
    await db.execute(
      `INSERT INTO ${tabela} (bairro, taxa) VALUES (?, ?) 
       ON CONFLICT(bairro) DO UPDATE SET taxa = excluded.taxa`,
      [cleanBairro, cleanTaxa]
    );

    return res.json(200, {
      success: true,
      message: `Taxa do bairro "${cleanBairro}" atualizada para R$ ${cleanTaxa.toFixed(2)} na tabela ${cleanGrupo}!`
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar taxa de bairro:', error);
    return res.json(500, { success: false, message: 'Erro ao atualizar taxa.', error: error.message });
  }
}

/**
 * Atribuição Manual de Pedido a um Entregador pela Cozinha / Admin
 * POST /api/admin/pedidos/atribuir
 * Body: { pedido_id, motoboy_id, status }
 */
async function atribuirPedidoMotoboy(req, res) {
  try {
    const { pedido_id, motoboy_id, status } = req.body || {};

    if (!pedido_id || !motoboy_id) {
      return res.json(400, { success: false, message: 'Campos pedido_id e motoboy_id são obrigatórios.' });
    }

    const db = getDb();
    const pedidoIdNum = Number(pedido_id);
    const motoboyIdNum = Number(motoboy_id);
    const novoStatus = (status && typeof status === 'string') ? status : 'em_rota';

    // 1. Obter motoboy selecionado
    const motoboy = await db.queryOne(
      `SELECT id, nome, telefone, grupo, latitude, longitude, velocidade FROM motoboys WHERE id = ?`,
      [motoboyIdNum]
    );

    if (!motoboy) {
      return res.json(404, { success: false, message: 'Entregador não encontrado no sistema.' });
    }

    // 2. Obter pedido
    const pedido = await db.queryOne(
      `SELECT id, numero_pedido, cliente, bairro, grupo, status, motoboy_id FROM pedidos WHERE id = ?`,
      [pedidoIdNum]
    );

    if (!pedido) {
      return res.json(404, { success: false, message: 'Pedido não encontrado.' });
    }

    const grupoFinal = motoboy.grupo || 'VELOZ';

    // 3. Atualizar o pedido para o entregador designado
    let updateSql = `UPDATE pedidos 
                     SET motoboy_id = ?, 
                         grupo = ?, 
                         status = ?`;
    const params = [motoboyIdNum, grupoFinal, novoStatus];

    if (novoStatus === 'em_rota') {
      updateSql += `, data_inicio = COALESCE(data_inicio, DATETIME('now', '-3 hours'))`;
    }

    updateSql += ` WHERE id = ?`;
    params.push(pedidoIdNum);

    await db.execute(updateSql, params);

    // 4. Se o motoboy tiver GPS conhecido e for rota ativa, registrar ponto de início
    if (novoStatus === 'em_rota' && motoboy.latitude !== null && motoboy.longitude !== null) {
      await db.execute(
        `INSERT INTO pedido_rotas (pedido_id, motoboy_id, latitude, longitude, velocidade, criado_em) 
         VALUES (?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
        [pedidoIdNum, motoboyIdNum, Number(motoboy.latitude), Number(motoboy.longitude), Number(motoboy.velocidade || 0)]
      );
    }

    const pedidoAtualizado = await db.queryOne(
      `SELECT p.*, m.nome as motoboy_nome, m.telefone as motoboy_telefone 
       FROM pedidos p 
       LEFT JOIN motoboys m ON p.motoboy_id = m.id 
       WHERE p.id = ?`,
      [pedidoIdNum]
    );

    return res.json(200, {
      success: true,
      message: `Pedido #${pedido.numero_pedido} atribuído com sucesso a ${motoboy.nome} (${grupoFinal})!`,
      pedido: pedidoAtualizado
    });
  } catch (error) {
    console.error('❌ Erro ao atribuir pedido a entregador:', error);
    return res.json(500, { success: false, message: 'Erro ao atribuir pedido a entregador.', error: error.message });
  }
}

module.exports = {
  getPosicoesMapa,
  getDashboardStats,
  listarTodosPedidos,
  listarMotoboysAdmin,
  obterFechamentoEntregas,
  criarPedidoManual,
  limparPedidosPendentesAntigos,
  verificarSenhaMotoboys,
  atualizarMotoboy,
  cadastrarMotoboyAdmin,
  obterTaxasBairros,
  atualizarTaxaBairro,
  atribuirPedidoMotoboy
};
