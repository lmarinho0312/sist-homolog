const { getDb } = require('../database/db');
const { obterTaxaRepasse, obterNomeBairroCanonica } = require('../utils/rateResolver');

/**
 * Consulta o histórico de entregas concluídas ou em andamento com duração
 * GET /api/admin/historico
 */
async function listarHistoricoEntregas(req, res) {
  try {
    const db = getDb();

    const entregas = await db.query(`
      SELECT p.id as pedido_id,
             p.numero_pedido,
             p.status,
             p.origem,
             p.grupo as pedido_grupo,
             p.cliente,
             p.endereco,
             p.bairro,
             p.taxa_entrega,
             p.texto_bruto,
             p.data_inicio,
             p.data_fim,
             m.id as motoboy_id,
             m.nome as motoboy_nome,
             m.telefone as motoboy_telefone,
             m.grupo as motoboy_grupo,
             CASE 
               WHEN p.data_fim IS NOT NULL THEN ROUND((julianday(p.data_fim) - julianday(p.data_inicio)) * 1440)
               ELSE ROUND((julianday(DATETIME('now', '-3 hours')) - julianday(COALESCE(p.data_inicio, DATETIME('now', '-3 hours')))) * 1440)
             END as duracao_minutos,
             (SELECT COUNT(*) FROM pedido_rotas pr WHERE pr.pedido_id = p.id) as total_pontos_gps
      FROM pedidos p
      LEFT JOIN motoboys m ON p.motoboy_id = m.id
      ORDER BY p.id DESC
    `);

    return res.json(200, {
      success: true,
      total: entregas.length,
      entregas: entregas.map(e => {
        const grupoEfetivo = (e.motoboy_grupo === 'SPEED' || e.pedido_grupo === 'SPEED') ? 'SPEED' : 'VELOZ';
        const taxaEfetiva = obterTaxaRepasse(e.bairro, e.endereco, e.texto_bruto, grupoEfetivo);
        const bairroNome = obterNomeBairroCanonica(e.bairro, e.endereco, e.texto_bruto) || e.bairro;
        return {
          pedido_id: e.pedido_id,
          numero_pedido: e.numero_pedido,
          status: e.status,
          origem: e.origem || 'MANUAL',
          grupo: e.pedido_grupo || e.motoboy_grupo || null,
          cliente: e.cliente || null,
          endereco: e.endereco || null,
          bairro: bairroNome || null,
          taxa_repasse: taxaEfetiva,
          taxa_entrega: taxaEfetiva,
          data_inicio: e.data_inicio,
          data_fim: e.data_fim,
          duracao_minutos: e.duracao_minutos !== null ? Math.max(0, Math.round(e.duracao_minutos)) : 0,
          motoboy: {
            id: e.motoboy_id,
            nome: e.motoboy_nome || (e.status === 'disponivel' ? 'Aguardando Retirada' : 'Desconhecido'),
            telefone: e.motoboy_telefone || '-',
            grupo: e.motoboy_grupo || null
          },
          total_pontos_gps: Number(e.total_pontos_gps || 0)
        };
      })
    });
  } catch (error) {
    console.error('❌ Erro ao listar histórico de entregas:', error);
    return res.json(500, { success: false, message: 'Erro interno ao listar histórico.', error: error.message });
  }
}

/**
 * Consulta a rota GPS percorrida de um pedido específico
 * GET /api/admin/historico/rota?pedido_id=X
 */
async function obterRotaPedido(req, res) {
  try {
    const pedido_id = req.query.pedido_id;

    if (!pedido_id) {
      return res.json(400, { success: false, message: 'ID do pedido é obrigatório (query param pedido_id).' });
    }

    const db = getDb();
    const pedidoIdNum = Number(pedido_id);

    const pedido = await db.queryOne(`
      SELECT p.id, p.numero_pedido, p.status, p.data_inicio, p.data_fim,
             m.nome as motoboy_nome, m.telefone as motoboy_telefone,
             CASE 
               WHEN p.data_fim IS NOT NULL THEN ROUND((julianday(p.data_fim) - julianday(p.data_inicio)) * 1440)
               ELSE ROUND((julianday(DATETIME('now', '-3 hours')) - julianday(p.data_inicio)) * 1440)
             END as duracao_minutos
      FROM pedidos p
      LEFT JOIN motoboys m ON p.motoboy_id = m.id
      WHERE p.id = ?
    `, [pedidoIdNum]);

    if (!pedido) {
      return res.json(404, { success: false, message: 'Pedido não encontrado.' });
    }

    const pontos = await db.query(`
      SELECT id, latitude, longitude, velocidade, criado_em
      FROM pedido_rotas
      WHERE pedido_id = ?
      ORDER BY id ASC
    `, [pedidoIdNum]);

    return res.json(200, {
      success: true,
      pedido: {
        id: pedido.id,
        numero_pedido: pedido.numero_pedido,
        status: pedido.status,
        data_inicio: pedido.data_inicio,
        data_fim: pedido.data_fim,
        duracao_minutos: pedido.duracao_minutos !== null ? Math.max(0, Math.round(pedido.duracao_minutos)) : 0,
        motoboy: {
          nome: pedido.motoboy_nome || 'Desconhecido',
          telefone: pedido.motoboy_telefone || '-'
        }
      },
      total_pontos: pontos.length,
      pontos: pontos.map(p => ({
        id: p.id,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        velocidade: Number(p.velocidade || 0),
        criado_em: p.criado_em
      }))
    });
  } catch (error) {
    console.error('❌ Erro ao obter rota do pedido:', error);
    return res.json(500, { success: false, message: 'Erro interno ao obter rota.', error: error.message });
  }
}

module.exports = {
  listarHistoricoEntregas,
  obterRotaPedido
};
