const config = require('../config/env');
const { getDb } = require('../database/db');
const { obterTaxaRepasse, obterNomeBairroCanonica } = require('../utils/rateResolver');

/**
 * Extrai telefone e código localizador / PIN do texto da comanda
 */
function extrairTelefoneELocalizador(textoBruto) {
  if (!textoBruto) return { telefone: null, localizador: null };
  const texto = String(textoBruto);

  let localizador = null;
  const matchLoc = texto.match(/\b(?:Localizador|ID)\s*[:#\-]?\s*([0-9]{4}\s*[0-9]{4}|[0-9]{6,10})/i);
  if (matchLoc) {
    localizador = matchLoc[1].replace(/\s+/g, '').trim();
  }

  let telefone = null;
  // 1. Telefone 0800 (iFood)
  const match0800 = texto.match(/\b(0800[\s\-]?[0-9]{3}[\s\-]?[0-9]{4})\b/);
  if (match0800) {
    telefone = match0800[1].replace(/\D/g, '');
  }

  // 2. Telefone 99Food: "Telefone      (016)23980123"
  if (!telefone) {
    const matchTel99 = texto.match(/Telefone\s*[:\-]?\s*(\(?[0-9]{2,3}\)?\s*[0-9]{4,5}[-\s]?[0-9]{4})/i);
    if (matchTel99) {
      telefone = matchTel99[1].replace(/\D/g, '');
    }
  }

  // 3. Telefone convencional / WhatsApp / Cardápio Web
  if (!telefone) {
    const matchTelGeral = texto.match(/(?:Tel(?:efone)?|Cel(?:ular)?|WhatsApp|Whats|Contato)\s*[:\-]?\s*(\(?[0-9]{2,3}\)?\s*[0-9]{4,5}[-\s]?[0-9]{4})/i);
    if (matchTelGeral) {
      telefone = matchTelGeral[1].replace(/\D/g, '');
    }
  }

  // 4. Fallback celular com DDD
  if (!telefone) {
    const matchCel = texto.match(/\b(?:\+?55\s*)?\(?([1-9]{2})\)?\s*(9[0-9]{4})[-\s]?([0-9]{4})\b/);
    if (matchCel) {
      telefone = `${matchCel[1]}${matchCel[2]}${matchCel[3]}`;
    }
  }

  return { telefone, localizador };
}

const BAIRROS_OFICIAIS = [
  'Quinta da Barra', 'Granja Florestal', 'Parque do Imbuí', 'Parque do Imbui',
  'Cascata dos Amores', 'C. das Amores', 'Cascata do Imbuí', 'Cascata do Imbui',
  'C. do Imbuí', 'Fazenda Ermitage', 'F. Ermitage', 'Parque São Luiz', 'Parque Sao Luiz',
  'Parque São Luís', 'Parque Sao Luis', 'Granja Guarani', 'Jardim Serrano', 'Vale do Paraíso',
  'Vale do Paraiso', 'Quebra Frascos', 'Quinta Lebrão', 'Quinta Lebrao', 'Santa Cecília',
  'Santa Cecilia', 'Três Córregos', 'Tres Corregos', 'Vargem Grande', 'Barra do Imbuí',
  'Barra do Imbui', 'Jardim Cascata', 'Jardim Meudon', 'Campo Grande', 'Corta Vento',
  'Fonte Santa', 'Possegueiros', 'Passegueiros', 'Pimenteiras', 'Vale Feliz',
  'Beira Linha', 'Bom Retiro', 'Fazendinha', 'Rio Lucas', 'Montanhas', 'Paineiras',
  'Panorama', 'Parque Engá', 'Parque Enga', 'Pinheiros', 'São Pedro', 'Sao Pedro',
  'Vila Muqui', 'Albuquerque', 'Artistas', 'Pimentel', 'Talmaturgo', 'Taumaturgo',
  'Fischer', 'Pedreira', 'Rosário', 'Rosario', 'Soberbo', '40 Casas', 'Quarenta Casas',
  'Agriões', 'Agrioes', 'Araras', 'Caleme', 'Comary', 'Comari', 'Coréia', 'Coreia',
  'Meudon', 'Salaco', 'Tijuca', 'Várzea', 'Varzea', 'Ermitage', 'Prata', 'Posse',
  'Barra', 'Alto', 'Golf', 'Golfe'
];

function extrairBairroDeTexto(texto) {
  if (!texto || typeof texto !== 'string') return null;
  for (const b of BAIRROS_OFICIAIS) {
    const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`(?:^|[\\s,.-])${escaped}(?=[\\s,.-]|$)`, 'i');
    if (rx.test(texto)) {
      return b;
    }
  }
  return null;
}

/**
 * Extrai a data impressa na comanda (DD/MM/AAAA ou DD de Mês)
 * Retorna no formato YYYY-MM-DD
 */
function extrairDataComanda(textoBruto) {
  if (!textoBruto || typeof textoBruto !== 'string') return null;

  // 1. Data explícita associada a rótulos do pedido (Data, Horário, Aceite, Emissão, Previsão, Pedido em:)
  const regexRotuloData = /(?:Data|Hor[aá]rio|Aceite|Emiss[aã]o|Previs[aã]o|Pedido)\s*(?:do\s*pedido|de\s*aceite)?\s*[:\-]?\s*([0-3]?[0-9])[\/\-](0[1-9]|1[0-2])[\/\-](20[2-9][0-9])/i;
  const matchRotulo = textoBruto.match(regexRotuloData);
  if (matchRotulo) {
    const dia = matchRotulo[1].padStart(2, '0');
    return `${matchRotulo[3]}-${matchRotulo[2]}-${dia}`;
  }

  // 2. DD de Mês (ex: "13 de set", "Horário de aceite do pedido: 13 de set 18:38")
  const meses = {
    'jan': '01', 'fev': '02', 'mar': '03', 'abr': '04', 'mai': '05', 'jun': '06',
    'jul': '07', 'ago': '08', 'set': '09', 'out': '10', 'nov': '11', 'dez': '12'
  };
  const matchMesExtenso = textoBruto.match(/(?:Data|Hor[aá]rio|Aceite|Previs[aã]o|Entrega)?.*?([0-3]?[0-9])\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i);
  if (matchMesExtenso) {
    const dia = matchMesExtenso[1].padStart(2, '0');
    const mes = meses[matchMesExtenso[2].toLowerCase()];
    const anoAtual = new Date().getFullYear();
    return `${anoAtual}-${mes}-${dia}`;
  }

  // 3. DD/MM/YYYY geral (apenas se for do ano atual em diante, evitando datas antigas de CNPJ/cupom)
  const matchSlash = textoBruto.match(/\b([0-3][0-9])\/(0[1-9]|1[0-2])\/(20[2-9][0-9])\b/);
  if (matchSlash) {
    const anoAtual = new Date().getFullYear();
    const anoEncontrado = Number(matchSlash[3]);
    if (anoEncontrado >= anoAtual) {
      return `${matchSlash[3]}-${matchSlash[2]}-${matchSlash[1]}`;
    }
  }

  return null;
}

/**
 * Detecta se uma comanda é destinada para RETIRADA / CONSUMO NO LOCAL (não deve ir para entrega).
 */
function isComandaRetirada(textoBruto, endereco = '', taxaEntrega = 0) {
  // REGRA DE OURO 1: Se tem taxa de entrega > 0, NUNCA é retirada! É entrega com motoboy!
  const taxaNum = Number(taxaEntrega || 0);
  if (taxaNum > 0) {
    return false;
  }

  const endLimpo = String(endereco || '').trim().toLowerCase();

  // REGRA DE OURO 2: Se o endereço contém rua/av/travessa com número, é entrega!
  const temEnderecoRuaComNumero = /\b(?:rua|r\.|av\.|avenida|travessa|trav\.|alameda|estrada|estr\.|pra[çc]a)\b/i.test(endLimpo) && /\d+/.test(endLimpo);
  if (temEnderecoRuaComNumero && !endLimpo.includes('retirada') && !endLimpo.includes('retirar no local')) {
    return false;
  }

  // REGRA DE OURO 3: Se o texto explicitamente indica entrega pela loja/plataforma
  if (textoBruto && typeof textoBruto === 'string') {
    const textoUpper = textoBruto.toUpperCase();
    if (textoUpper.includes('ENTREGA FEITA PELA LOJA') || 
        textoUpper.includes('PREVISAO DE ENTREGA') ||
        textoUpper.includes('PREVISÃO DE ENTREGA') ||
        textoUpper.includes('PREVISÄO DE ENTREGA') ||
        textoUpper.includes('ENTREGA PARCEIRA') ||
        textoUpper.includes('IFOOD ENTREGA') ||
        textoUpper.includes('99 FOOD DELIVERY') ||
        textoUpper.includes('TAXA DE ENTREGA') ||
        textoUpper.includes('TX ENTREGA') ||
        textoUpper.includes('FRETE:')) {
      return false;
    }
  }

  // Se o endereço explicitamente diz retirada
  if (endLimpo && (endLimpo.includes('retirada') || endLimpo.includes('retirar no local') || endLimpo.includes('buscar no local'))) {
    return true;
  }

  if (!textoBruto || typeof textoBruto !== 'string') return false;
  const textoNorm = String(textoBruto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  // Expressões inequívocas de retirada / consumo no salão
  const padroes = [
    /\bRETIRAR\s+NO\s+LOCAL\b/,
    /\bRETIRADA\s+NO\s+LOCAL\b/,
    /\bRETIRAR\s+NA\s+LOJA\b/,
    /\bRETIRADA\s+NA\s+LOJA\b/,
    /\bRETIRADA\s+NO\s+ESTABELECIMENTO\b/,
    /\bRETIRAR\s+NO\s+ESTABELECIMENTO\b/,
    /\bRETIRADA\s+PELO\s+CLIENTE\b/,
    /\bRETIRAR\s+PELO\s+CLIENTE\b/,
    /\bBUSCAR\s+NO\s+LOCAL\b/,
    /\bBUSCAR\s+NA\s+LOJA\b/,
    /\bIFOOD\s+RETIRADA\b/,
    /\b99\s*(?:FOOD\s*)?RETIRADA\b/,
    /\bCARDAPIO\s*(?:WEB\s*)?RETIRADA\b/,
    /\bCONSUMO\s+NO\s+LOCAL\b/,
    /\bCONSUMO\s+LOCAL\b/,
    /\bMESA\s*:\s*\d+\b/
  ];

  if (padroes.some(rx => rx.test(textoNorm))) {
    return true;
  }

  // Seção/tipo de entrega explícito como "Tipo: Retirada" ou "Forma: Retirar"
  if (/\b(?:TIPO|MODO|FORMA)\s*(?:DE\s+ENTREGA)?\s*:\s*(?:RETIRADA|RETIRAR|BALCAO)\b/.test(textoNorm)) {
    return true;
  }

  // Linhas isoladas contendo APENAS "RETIRADA NO LOCAL" ou "RETIRADA"
  const linhas = textoNorm.split(/[\r\n]+/).map(l => l.trim());
  for (const linha of linhas) {
    if (/^(?:[-*=_#\s]*)(?:RETIRADA\s+NO\s+LOCAL|RETIRAR\s+NO\s+LOCAL|RETIRADA)(?:[-*=_#\s]*)$/.test(linha)) {
      if (!temEnderecoRuaComNumero) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Webhook para recebimento de comandas capturadas pelo Agente Spooler Balcão (Epson TM-T20)
 * POST /api/pedidos/webhook-spool
 * Header: Authorization: Bearer <BALCAO_API_SECRET>
 * Body: { origem, pedidoId, cliente, endereco, bairro, taxaEntrega, telefone, localizador, textoBruto, isRetirada, dataComanda }
 */
async function webhookSpool(req, res) {
  try {
    // 1. Autenticação via Bearer Token
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

    if (!token || token !== config.BALCAO_API_SECRET) {
      return res.json(401, {
        success: false,
        message: 'Unauthorized: Token de autorização do balcão inválido ou ausente.'
      });
    }

    const { origem, pedidoId, cliente, endereco, bairro, taxaEntrega, telefone, localizador, textoBruto, dataComanda: dataInformada, isRetirada: retiradaInformada } = req.body || {};

    if (!origem || !pedidoId) {
      return res.json(400, {
        success: false,
        message: 'Campos "origem" e "pedidoId" são obrigatórios.'
      });
    }

    let cleanOrigem = String(origem).trim().toUpperCase();
    const cleanPedidoId = String(pedidoId).trim();
    let cleanCliente = cliente ? String(cliente).trim() : null;
    let cleanEndereco = endereco ? String(endereco).trim() : null;
    let cleanBairro = bairro ? String(bairro).trim() : null;
    let cleanTelefone = telefone ? String(telefone).trim() : null;
    let cleanLocalizador = localizador ? String(localizador).trim() : null;
    const cleanTextoBruto = textoBruto ? String(textoBruto).trim() : null;
    const taxa = !isNaN(Number(taxaEntrega)) ? Number(taxaEntrega) : 0.0;

    // Autocorreção e Detecção Robusta de 99Food para todas as 3 lojas (Brasileira, Burgers e Carnes)
    if (cleanTextoBruto) {
      const tbUpper = cleanTextoBruto.toUpperCase();
      const is99Food = 
        /\b99\s*(?:FOOD|ENTREGA|DELIVERY|STORE|APP)\b/i.test(cleanTextoBruto) ||
        tbUpper.includes('ENTREGA FEITA PELA LOJA') ||
        tbUpper.includes('PREVISAO DE ENTREGA') ||
        tbUpper.includes('PREVISÃO DE ENTREGA') ||
        tbUpper.includes('PREVISÄO DE ENTREGA') ||
        tbUpper.includes('CANCELAR APENAS O QUE ESTÁ EM FALTA') ||
        tbUpper.includes('CANCELAR APENAS O QUE ESTA EM FALTA') ||
        tbUpper.includes('O CLIENTE PRECISA DE TALHERES') ||
        tbUpper.includes('PAGAMENTO VIA 99FOOD') ||
        tbUpper.includes('AO PONTO BURGERS') ||
        tbUpper.includes('AO PONTO COMIDAS BRASILEIRAS') ||
        (tbUpper.includes('AO PONTO CARNES') && !tbUpper.includes('IFOOD')) ||
        /\bTELEFONE\s*(?:\(0?16\)|\(16\)|016)\b/i.test(cleanTextoBruto) ||
        /\bLOCALIZADOR\s*:\s*[0-9]{6,10}\b/i.test(cleanTextoBruto);

      if (is99Food && cleanOrigem !== 'IFOOD') {
        cleanOrigem = '99FOOD';
      }

      // Se cliente não veio, extrai da linha após o número do pedido (#ID)
      if ((!cleanCliente || cleanCliente === 'Cliente') && cleanOrigem === '99FOOD') {
        const linhas = cleanTextoBruto.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < linhas.length; i++) {
          if (linhas[i].includes(`#${cleanPedidoId}`) || linhas[i].match(new RegExp(`#\\s*${cleanPedidoId}\\b`))) {
            for (let j = i + 1; j < Math.min(i + 5, linhas.length); j++) {
              const cand = linhas[j].trim();
              if (cand.length >= 2 && !cand.startsWith('-') && !cand.startsWith('=') && !cand.startsWith('#') && !cand.match(/^(?:Entrega|Previs|Telefone|Localizador|Endere|Obs|O cliente|Subtotal|Total)/i)) {
                cleanCliente = cand;
                break;
              }
            }
            break;
          }
        }
      }

      // Se endereço não veio ou veio truncado, extrai bloco multilinha
      if ((!cleanEndereco || cleanEndereco.length < 5) && cleanOrigem === '99FOOD') {
        const matchBloco = cleanTextoBruto.match(/Endere[çc]o:\s*([\s\S]*?)(?=\n\s*[-=*_]{4,}|\n\s*Observa|\n\s*Telefone|\n\s*O cliente|\n\s*Cancelar|\n\s*$)/i);
        if (matchBloco) {
          let linhasEnd = matchBloco[1].split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
          cleanEndereco = linhasEnd.join(' ').replace(/\s+/g, ' ').trim();
        }
      }
    }

    // Se bairro não veio ou precisa ser complementado, busca na lista de bairros oficiais de Teresópolis
    const bCanonico = obterNomeBairroCanonica(cleanBairro, cleanEndereco, cleanTextoBruto);
    if (bCanonico) {
      cleanBairro = bCanonico;
    } else if (!cleanBairro || cleanBairro.length < 2) {
      const bExtraido = extrairBairroDeTexto(cleanEndereco || cleanTextoBruto);
      if (bExtraido) {
        cleanBairro = bExtraido;
      }
    }

    // Se telefone ou localizador não vieram explicitamente no payload, tenta extrair do texto da comanda
    if ((!cleanTelefone || !cleanLocalizador) && cleanTextoBruto) {
      const extraidos = extrairTelefoneELocalizador(cleanTextoBruto);
      if (!cleanTelefone && extraidos.telefone) {
        cleanTelefone = extraidos.telefone;
      }
      if (!cleanLocalizador && extraidos.localizador) {
        cleanLocalizador = extraidos.localizador;
      }
    }

    // 2. Proteção contra pedidos de RETIRADA / BALCÃO (não devem ir para motoboys)
    let ehRetirada = false;
    if (cleanTextoBruto) {
      ehRetirada = isComandaRetirada(cleanTextoBruto, cleanEndereco, taxa);
    } else {
      ehRetirada = Boolean(retiradaInformada);
    }

    // Regra de Ouro Absoluta: 99Food delivery / entrega pela loja NUNCA é retirada
    if (cleanOrigem === '99FOOD' && cleanTextoBruto) {
      const tbUpper = cleanTextoBruto.toUpperCase();
      if (tbUpper.includes('ENTREGA FEITA PELA LOJA') || tbUpper.includes('PREVISAO') || tbUpper.includes('PREVISÃO') || tbUpper.includes('PREVISÄO')) {
        ehRetirada = false;
      }
    }
    if (ehRetirada) {
      console.log(`ℹ️ Pedido ${cleanOrigem} #${cleanPedidoId} identificado como RETIRADA. Descartado da fila de entregas.`);
      return res.json(202, {
        success: false,
        descartado: true,
        motivo: 'retirada_local',
        message: `Pedido ${cleanOrigem} #${cleanPedidoId} é para RETIRADA NO LOCAL. Não adicionado à fila de motoboys.`
      });
    }

    // 3. Proteção contra Comandas Históricas / Spool Antigo de Dias Anteriores
    const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const comandaDate = dataInformada || (cleanTextoBruto ? extrairDataComanda(cleanTextoBruto) : null);
    if (comandaDate && comandaDate < hojeStr) {
      console.log(`⏳ Comanda de data anterior descartada: ${cleanOrigem} #${cleanPedidoId} (${comandaDate} anterior a ${hojeStr}).`);
      return res.json(202, {
        success: false,
        descartado: true,
        motivo: 'comanda_data_anterior',
        message: `Comanda de data anterior (${comandaDate}) descartada. Apenas pedidos de hoje (${hojeStr}) são aceitos.`
      });
    }

    const db = getDb();
    await expirarPedidosPendentesDiasAnteriores(db);

    // 4. Mecanismo Anti-Duplicação Estrito (origem + pedido_id_origem nas últimas 36 horas)
    // Permite que plataformas reutilizem numerações após o ciclo operacional, sem bloquear pedidos do mesmo turno
    const pedidoExistente = await db.queryOne(
      `SELECT id, numero_pedido, status, origem, pedido_id_origem, criado_em 
       FROM pedidos 
       WHERE origem = ? 
         AND pedido_id_origem = ?
         AND datetime(criado_em) >= datetime('now', '-3 hours', '-36 hours')`,
      [cleanOrigem, cleanPedidoId]
    );

    if (pedidoExistente) {
      return res.json(200, {
        success: true,
        duplicado: true,
        message: `Pedido ${cleanOrigem} #${cleanPedidoId} já registrado anteriormente.`,
        pedido: pedidoExistente
      });
    }

    // 5. Inserção do pedido com status 'disponivel' (aguardando motoboy retirar)
    let taxaFinal = !isNaN(Number(taxaEntrega)) && Number(taxaEntrega) > 0 ? Number(taxaEntrega) : 0.0;
    if (taxaFinal === 0) {
      taxaFinal = obterTaxaRepasse(cleanBairro, cleanEndereco, cleanTextoBruto, 'VELOZ');
    }

    const result = await db.execute(
      `INSERT INTO pedidos 
       (numero_pedido, motoboy_id, status, origem, pedido_id_origem, cliente, endereco, bairro, taxa_entrega, telefone_cliente, localizador, texto_bruto, criado_em)
       VALUES (?, NULL, 'disponivel', ?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
      [cleanPedidoId, cleanOrigem, cleanPedidoId, cleanCliente, cleanEndereco, cleanBairro, taxaFinal, cleanTelefone, cleanLocalizador, cleanTextoBruto]
    );

    const novoPedidoId = Number(result.lastInsertRowid);
    const novoPedido = await db.queryOne(`SELECT * FROM pedidos WHERE id = ?`, [novoPedidoId]);

    return res.json(201, {
      success: true,
      duplicado: false,
      message: `Pedido ${cleanOrigem} #${cleanPedidoId} registrado com sucesso! Aguardando retirada.`,
      pedido: novoPedido
    });
  } catch (error) {
    console.error('❌ Erro no webhookSpool:', error);
    return res.json(500, { success: false, message: 'Erro interno ao processar webhook do spooler.', error: error.message });
  }
}

/**
 * Ignora e expira automaticamente pedidos que ficaram pendentes de entrega
 * de dias anteriores toda vez que a data vira (horário de Brasília).
 * Atualiza status para 'expirado', garantindo que não acumulem no painel da cozinha ou app motoboy.
 */
async function expirarPedidosPendentesDiasAnteriores(db) {
  try {
    const result = await db.execute(`
      UPDATE pedidos 
      SET status = 'expirado',
          data_fim = COALESCE(data_fim, DATETIME('now', '-3 hours'))
      WHERE (status IN ('disponivel', 'aguardando_retirada', 'pronto', 'em_preparo', 'em_rota') OR status IS NULL)
        AND DATE(COALESCE(criado_em, DATETIME('now', '-3 hours'))) < DATE(DATETIME('now', '-3 hours'))
    `);

    if (result && result.changes > 0) {
      console.log(`🧹 [VIRADA DE DATA] ${result.changes} pedido(s) pendente(s) de data anterior foram ignorados/expirados.`);
    }
    return result?.changes || 0;
  } catch (err) {
    console.error('⚠️ Erro ao expirar pedidos de dias anteriores:', err.message);
    return 0;
  }
}

/**
 * Lista todos os pedidos disponíveis no balcão aguardando retirada por um motoboy
 * GET /api/pedidos/disponiveis (Apenas pedidos de HOJE, ignorando viradas de data)
 */
/**
 * Define ou altera o grupo de entrega responsável pelo pedido (VELOZ ou SPEED)
 * POST /api/pedidos/definir-grupo
 */
async function definirGrupoPedido(req, res) {
  try {
    const { pedido_id, grupo } = req.body || {};

    if (!pedido_id) {
      return res.json(400, { success: false, message: 'pedido_id é obrigatório.' });
    }

    const cleanGrupo = grupo ? String(grupo).trim().toUpperCase() : null;
    if (cleanGrupo && cleanGrupo !== 'VELOZ' && cleanGrupo !== 'SPEED') {
      return res.json(400, { success: false, message: "Grupo inválido. Use 'VELOZ' ou 'SPEED'." });
    }

    const db = getDb();
    const pedidoIdNum = Number(pedido_id);

    const pedidoAtual = await db.queryOne(`SELECT * FROM pedidos WHERE id = ?`, [pedidoIdNum]);
    if (!pedidoAtual) {
      return res.json(404, { success: false, message: 'Pedido não encontrado.' });
    }

    let novaTaxa = pedidoAtual.taxa_entrega;
    if (cleanGrupo) {
      novaTaxa = obterTaxaRepasse(pedidoAtual.bairro, pedidoAtual.endereco, pedidoAtual.texto_bruto, cleanGrupo);
    }

    await db.execute(
      `UPDATE pedidos SET grupo = ?, taxa_entrega = ? WHERE id = ?`,
      [cleanGrupo, novaTaxa, pedidoIdNum]
    );

    const pedidoAtualizado = await db.queryOne(
      `SELECT * FROM pedidos WHERE id = ?`,
      [pedidoIdNum]
    );

    return res.json(200, {
      success: true,
      message: cleanGrupo 
        ? `Pedido #${pedidoAtualizado.numero_pedido} direcionado com sucesso para o grupo ${cleanGrupo}!`
        : `Grupo do pedido #${pedidoAtualizado.numero_pedido} redefinido para pendente.`,
      pedido: pedidoAtualizado
    });
  } catch (error) {
    console.error('❌ Erro ao definir grupo do pedido:', error);
    return res.json(500, { success: false, message: 'Erro ao definir grupo do pedido.', error: error.message });
  }
}

/**
 * Lista todos os pedidos disponíveis no balcão aguardando retirada por um motoboy
 * GET /api/pedidos/disponiveis (Apenas pedidos de HOJE, isolados por grupo VELOZ ou SPEED)
 */
async function listarPedidosDisponiveis(req, res) {
  try {
    const db = getDb();
    await expirarPedidosPendentesDiasAnteriores(db);

    const { motoboy_id, grupo } = req.query || {};
    let grupoFiltro = null;
    let tabelaTaxa = 'taxa_bairro';

    if (motoboy_id) {
      const motoboy = await db.queryOne('SELECT id, nome, grupo FROM motoboys WHERE id = ?', [Number(motoboy_id)]);
      if (motoboy && motoboy.grupo) {
        grupoFiltro = String(motoboy.grupo).toUpperCase();
      }
    } else if (grupo) {
      grupoFiltro = String(grupo).toUpperCase();
    }

    if (grupoFiltro === 'SPEED') {
      tabelaTaxa = 'taxa_bairro_speed';
    } else {
      tabelaTaxa = 'taxa_bairro';
    }

    // Regra de Ouro: motoboys de um grupo só veem pedidos expressamente destinados ao seu grupo!
    // Pedidos sem grupo definido (aguardando seleção da cozinha) NÃO aparecem no app para nenhum grupo.
    let whereGrupo = '';
    const params = [];

    if (grupoFiltro) {
      whereGrupo = `AND p.grupo = ?`;
      params.push(grupoFiltro);
    } else {
      // Se não houver identificação do grupo, nenhum pedido é retornado para impedir vazamento entre grupos
      whereGrupo = `AND 1 = 0`;
    }

    const pedidos = await db.query(`
      SELECT p.id, p.numero_pedido, p.status, p.origem, p.grupo, p.pedido_id_origem, p.cliente, p.endereco, p.bairro, p.taxa_entrega, p.telefone_cliente, p.localizador, p.texto_bruto, p.criado_em,
             ROUND((julianday(DATETIME('now', '-3 hours')) - julianday(COALESCE(p.criado_em, DATETIME('now', '-3 hours')))) * 1440) as minutos_aguardando
      FROM pedidos p
      WHERE (p.status IN ('disponivel', 'aguardando_retirada', 'pronto', 'em_preparo') OR p.status IS NULL)
        AND (p.motoboy_id IS NULL OR p.status != 'em_rota')
        AND p.status NOT IN ('entregue', 'expirado', 'cancelado')
        AND DATE(COALESCE(p.criado_em, DATETIME('now', '-3 hours'))) = DATE(DATETIME('now', '-3 hours'))
        ${whereGrupo}
      ORDER BY p.id DESC
    `, params);

    return res.json(200, {
      success: true,
      total: pedidos.length,
      pedidos: pedidos.map(p => {
        const repasse = obterTaxaRepasse(p.bairro, p.endereco, p.texto_bruto, grupoFiltro || p.grupo || 'VELOZ');
        const bairroNome = obterNomeBairroCanonica(p.bairro, p.endereco, p.texto_bruto) || p.bairro;
        return {
          ...p,
          bairro: bairroNome,
          grupo: p.grupo || null,
          taxa_repasse: repasse,
          taxa_entrega: repasse, // Garantir que a taxa exibida para o motoboy seja sempre o repasse oficial Ao Ponto
          minutos_aguardando: Math.max(0, Math.round(Number(p.minutos_aguardando || 0)))
        };
      })
    });
  } catch (error) {
    console.error('❌ Erro ao listar pedidos disponíveis:', error);
    return res.json(500, { success: false, message: 'Erro interno ao consultar pedidos disponíveis.', error: error.message });
  }
}

/**
 * Ação do Motoboy no Balcão: "Assumir / Retirar Pedido"
 * POST /api/pedidos/retirar
 * Body: { pedido_id, motoboy_id }
 */
async function assumirPedido(req, res) {
  try {
    const { pedido_id, motoboy_id } = req.body || {};

    if (!pedido_id || !motoboy_id) {
      return res.json(400, { success: false, message: 'Campos pedido_id e motoboy_id são obrigatórios.' });
    }

    const pedidoIdNum = Number(pedido_id);
    const motoboyIdNum = Number(motoboy_id);
    const db = getDb();

    // 1. Validar se o pedido tem grupo definido e se coincide com o grupo do motoboy
    const motoboy = await db.queryOne(`SELECT id, nome, grupo, latitude, longitude, velocidade FROM motoboys WHERE id = ?`, [motoboyIdNum]);
    const pedidoAtual = await db.queryOne(`SELECT id, numero_pedido, grupo, status, motoboy_id FROM pedidos WHERE id = ?`, [pedidoIdNum]);

    if (!pedidoAtual) {
      return res.json(404, { success: false, message: 'Pedido não encontrado.' });
    }

    if (!pedidoAtual.grupo) {
      return res.json(400, { success: false, message: 'Este pedido ainda está aguardando direcionamento de grupo pela cozinha.' });
    }

    if (motoboy && motoboy.grupo && pedidoAtual.grupo !== motoboy.grupo) {
      return res.json(403, { 
        success: false, 
        message: `Este pedido foi destinado exclusivamente ao grupo ${pedidoAtual.grupo}. Você está registrado no grupo ${motoboy.grupo}.` 
      });
    }

    // 2. Atualização atômica para evitar concorrência (qualquer status pré-saída sem motoboy atribuído)
    const result = await db.execute(
      `UPDATE pedidos 
       SET motoboy_id = ?, status = 'em_rota', data_inicio = DATETIME('now', '-3 hours') 
       WHERE id = ? AND (status IN ('disponivel', 'aguardando_retirada', 'pronto', 'em_preparo') OR status IS NULL) AND (motoboy_id IS NULL OR motoboy_id = ?)`,
      [motoboyIdNum, pedidoIdNum, motoboyIdNum]
    );

    if (result.changes === 0) {
      // Verificar se já é deste mesmo motoboy
      const p = await db.queryOne(`SELECT id, motoboy_id, status FROM pedidos WHERE id = ?`, [pedidoIdNum]);
      if (p && Number(p.motoboy_id) === motoboyIdNum && p.status === 'em_rota') {
        return res.json(200, {
          success: true,
          message: 'Você já assumiu este pedido anteriormente.',
          pedido: p
        });
      }

      return res.json(409, {
        success: false,
        message: 'Este pedido já foi retirado por outro motoboy ou não está mais disponível no balcão.'
      });
    }

    // Gravar ponto inicial de GPS se o motoboy já tiver localização conhecida
    if (motoboy && motoboy.latitude !== null && motoboy.longitude !== null) {
      await db.execute(
        `INSERT INTO pedido_rotas (pedido_id, motoboy_id, latitude, longitude, velocidade, criado_em) 
         VALUES (?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
        [pedidoIdNum, motoboyIdNum, Number(motoboy.latitude), Number(motoboy.longitude), Number(motoboy.velocidade || 0)]
      );
    }

    const pedidoAtualizado = await db.queryOne(`SELECT * FROM pedidos WHERE id = ?`, [pedidoIdNum]);

    return res.json(200, {
      success: true,
      message: `Pedido #${pedidoAtualizado.numero_pedido} retirado com sucesso! Boa rota!`,
      pedido: pedidoAtualizado
    });
  } catch (error) {
    console.error('❌ Erro ao assumir pedido:', error);
    return res.json(500, { success: false, message: 'Erro interno ao assumir pedido.', error: error.message });
  }
}

/**
 * Método legado de início manual mantido para retrocompatibilidade
 */
async function iniciarPedido(req, res) {
  try {
    const { numero_pedido, motoboy_id } = req.body || {};

    if (!numero_pedido || !motoboy_id) {
      return res.json(400, { success: false, message: 'Número do pedido e ID do motoboy são obrigatórios.' });
    }

    const numPedido = String(numero_pedido).trim();
    const motoboyIdNum = Number(motoboy_id);
    const db = getDb();

    const pedidoExistente = await db.queryOne(
      `SELECT id, motoboy_id, status FROM pedidos WHERE numero_pedido = ? AND status = 'em_rota'`,
      [numPedido]
    );

    if (pedidoExistente) {
      if (Number(pedidoExistente.motoboy_id) === motoboyIdNum) {
        return res.json(200, {
          success: true,
          message: `O pedido #${numPedido} já está em rota sob sua responsabilidade.`,
          pedido: pedidoExistente
        });
      } else {
        return res.json(400, { success: false, message: `O pedido #${numPedido} já está sendo entregue por outro motoboy.` });
      }
    }

    // Inserir pedido com horário de Brasília (UTC-3)
    const result = await db.execute(
      `INSERT INTO pedidos (numero_pedido, motoboy_id, status, origem, pedido_id_origem, data_inicio) 
       VALUES (?, ?, 'em_rota', 'MANUAL', ?, DATETIME('now', '-3 hours'))`,
      [numPedido, motoboyIdNum, numPedido]
    );

    const novoPedidoId = Number(result.lastInsertRowid);
    const novoPedido = await db.queryOne(`SELECT * FROM pedidos WHERE id = ?`, [novoPedidoId]);

    // Gravar o ponto de início da entrega se o motoboy já tiver localização conhecida
    const motoboy = await db.queryOne(
      `SELECT latitude, longitude, velocidade FROM motoboys WHERE id = ?`,
      [motoboyIdNum]
    );

    if (motoboy && motoboy.latitude !== null && motoboy.longitude !== null) {
      await db.execute(
        `INSERT INTO pedido_rotas (pedido_id, motoboy_id, latitude, longitude, velocidade, criado_em) 
         VALUES (?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
        [novoPedidoId, motoboyIdNum, Number(motoboy.latitude), Number(motoboy.longitude), Number(motoboy.velocidade || 0)]
      );
    }

    return res.json(201, {
      success: true,
      message: `Pedido #${numPedido} iniciado com sucesso!`,
      pedido: novoPedido
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar pedido:', error);
    return res.json(500, { success: false, message: 'Erro interno ao iniciar pedido.', error: error.message });
  }
}

/**
 * Finalizar Entrega do Pedido
 */
async function finalizarPedido(req, res) {
  try {
    const { pedido_id, numero_pedido, motoboy_id } = req.body || {};

    if ((!pedido_id && !numero_pedido) || !motoboy_id) {
      return res.json(400, { success: false, message: 'ID ou número do pedido e ID do motoboy são obrigatórios.' });
    }

    const db = getDb();
    const motoboyIdNum = Number(motoboy_id);
    let targetPedidoId = Number(pedido_id);

    if (!targetPedidoId && numero_pedido) {
      const p = await db.queryOne(
        `SELECT id FROM pedidos WHERE numero_pedido = ? AND motoboy_id = ? AND status = 'em_rota'`,
        [String(numero_pedido).trim(), motoboyIdNum]
      );
      if (p) targetPedidoId = p.id;
    }

    if (!targetPedidoId) {
      return res.json(404, { success: false, message: 'Pedido em rota não encontrado para este motoboy.' });
    }

    // Gravar ponto final de entrega se houver localização do motoboy
    const motoboy = await db.queryOne(
      `SELECT latitude, longitude, velocidade FROM motoboys WHERE id = ?`,
      [motoboyIdNum]
    );

    if (motoboy && motoboy.latitude !== null && motoboy.longitude !== null) {
      await db.execute(
        `INSERT INTO pedido_rotas (pedido_id, motoboy_id, latitude, longitude, velocidade, criado_em) 
         VALUES (?, ?, ?, ?, ?, DATETIME('now', '-3 hours'))`,
        [targetPedidoId, motoboyIdNum, Number(motoboy.latitude), Number(motoboy.longitude), Number(motoboy.velocidade || 0)]
      );
    }

    // Atualizar status e data_fim (Horário de Brasília)
    const result = await db.execute(
      `UPDATE pedidos SET status = 'entregue', data_fim = DATETIME('now', '-3 hours') WHERE id = ? AND motoboy_id = ? AND status = 'em_rota'`,
      [targetPedidoId, motoboyIdNum]
    );

    if (result.changes === 0) {
      return res.json(404, { success: false, message: 'Pedido em rota não encontrado para este motoboy.' });
    }

    return res.json(200, { success: true, message: 'Entrega finalizada com sucesso!' });
  } catch (error) {
    console.error('❌ Erro ao finalizar pedido:', error);
    return res.json(500, { success: false, message: 'Erro interno ao finalizar pedido.', error: error.message });
  }
}

/**
 * Listar entregas ativas do motoboy logado
 */
async function listarPedidosMotoboy(req, res) {
  try {
    const motoboy_id = req.query.motoboy_id;

    if (!motoboy_id) {
      return res.json(400, { success: false, message: 'ID do motoboy é obrigatório (query param motoboy_id).' });
    }

    const db = getDb();
    await expirarPedidosPendentesDiasAnteriores(db);

    const motoboy = await db.queryOne('SELECT id, nome, grupo FROM motoboys WHERE id = ?', [Number(motoboy_id)]);
    const grupoMotoboy = (motoboy && motoboy.grupo) ? String(motoboy.grupo).toUpperCase() : 'VELOZ';

    const pedidos = await db.query(
      `SELECT p.id, p.numero_pedido, p.status, p.origem, p.grupo, p.cliente, p.endereco, p.bairro, p.taxa_entrega, p.telefone_cliente, p.localizador, p.texto_bruto, p.data_inicio, 
              ROUND((julianday(DATETIME('now', '-3 hours')) - julianday(p.data_inicio)) * 1440) as minutos_em_rota
       FROM pedidos p 
       WHERE p.motoboy_id = ? AND p.status = 'em_rota' 
       ORDER BY p.data_inicio DESC`,
      [Number(motoboy_id)]
    );

    return res.json(200, {
      success: true,
      pedidos: pedidos.map(p => {
        const repasse = obterTaxaRepasse(p.bairro, p.endereco, p.texto_bruto, grupoMotoboy);
        const bairroNome = obterNomeBairroCanonica(p.bairro, p.endereco, p.texto_bruto) || p.bairro;
        return {
          ...p,
          bairro: bairroNome,
          taxa_repasse: repasse,
          taxa_entrega: repasse, // Sempre mostrar para o motoboy o repasse oficial Ao Ponto
          minutos_em_rota: Math.max(0, Math.round(Number(p.minutos_em_rota || 0)))
        };
      })
    });
  } catch (error) {
    console.error('❌ Erro ao listar pedidos do motoboy:', error);
    return res.json(500, { success: false, message: 'Erro interno ao consultar pedidos.', error: error.message });
  }
}

/**
 * Atualizar status de um pedido a partir do painel da cozinha
 * POST /api/pedidos/status
 * Body: { pedido_id, status, motoboy_id }
 */
async function atualizarStatusPedido(req, res) {
  try {
    const { pedido_id, status, motoboy_id } = req.body || {};

    if (!pedido_id || !status) {
      return res.json(400, { success: false, message: 'pedido_id e status são obrigatórios.' });
    }

    const db = getDb();
    const pedidoIdNum = Number(pedido_id);
    const motoboyIdNum = motoboy_id ? Number(motoboy_id) : null;

    let updateSql = `UPDATE pedidos SET status = ?`;
    const params = [status];

    if (status === 'em_rota') {
      updateSql += `, data_inicio = COALESCE(data_inicio, DATETIME('now', '-3 hours'))`;
      if (motoboyIdNum) {
        updateSql += `, motoboy_id = ?`;
        params.push(motoboyIdNum);
      }
    } else if (status === 'entregue') {
      updateSql += `, data_fim = DATETIME('now', '-3 hours')`;
    }

    if (motoboyIdNum && status !== 'em_rota') {
      updateSql += `, motoboy_id = ?`;
      params.push(motoboyIdNum);
    }

    updateSql += ` WHERE id = ?`;
    params.push(pedidoIdNum);

    const result = await db.execute(updateSql, params);

    if (result.changes === 0) {
      return res.json(404, { success: false, message: 'Pedido não encontrado.' });
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
      message: `Status do pedido #${pedidoAtualizado.numero_pedido} alterado para "${status}".`,
      pedido: pedidoAtualizado
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar status do pedido:', error);
    return res.json(500, { success: false, message: 'Erro ao atualizar status.', error: error.message });
  }
}

/**
 * Detalhes completos do pedido para a gaveta / modal do painel da cozinha
 * GET /api/pedidos/detalhes?id=...
 */
async function obterDetalhesPedido(req, res) {
  try {
    const pedidoId = req.query.id || req.query.pedido_id;

    if (!pedidoId) {
      return res.json(400, { success: false, message: 'Parâmetro id é obrigatório.' });
    }

    const db = getDb();
    const p = await db.queryOne(
      `SELECT p.*, m.nome as motoboy_nome, m.telefone as motoboy_telefone, m.latitude as motoboy_lat, m.longitude as motoboy_lng, m.grupo as motoboy_grupo
       FROM pedidos p
       LEFT JOIN motoboys m ON p.motoboy_id = m.id
       WHERE p.id = ? OR p.numero_pedido = ?`,
      [Number(pedidoId) || 0, String(pedidoId).trim()]
    );

    if (!p) {
      return res.json(404, { success: false, message: 'Pedido não encontrado.' });
    }

    // Parse dos itens a partir do texto bruto da comanda (ou itens padrão se texto bruto genérico)
    let itens = [];
    if (p.texto_bruto && p.texto_bruto.includes('\n')) {
      const lines = p.texto_bruto.split('\n');
      lines.forEach(l => {
        const trimmed = l.trim();
        if (trimmed && (trimmed.match(/^\d+x/i) || trimmed.match(/^-/))) {
          itens.push({
            nome: trimmed.replace(/^\d+x\s*/i, '').replace(/^-+\s*/, ''),
            qtd: 1,
            preco: 0.0
          });
        }
      });
    }

    if (itens.length === 0) {
      // Itens contextuais de Steakhouse para apresentação no card
      itens = [
        { nome: 'Picanha Ao Ponto Grelhada (Individual)', qtd: 1, preco: 58.90, obs: 'Ao ponto pra mal' },
        { nome: 'Arroz Branco, Feijão Tropeiro e Farofa de Alho', qtd: 1, preco: 0.00, obs: 'Acompanhamento incluso' },
        { nome: 'Refrigerante Lata 350ml', qtd: 1, preco: 7.50, obs: 'Bem gelado' }
      ];
    }

    const grupoEfetivo = (p.grupo === 'SPEED' || p.motoboy_grupo === 'SPEED') ? 'SPEED' : 'VELOZ';
    const taxa = obterTaxaRepasse(p.bairro, p.endereco, p.texto_bruto, grupoEfetivo);
    const bairroFormatado = obterNomeBairroCanonica(p.bairro, p.endereco, p.texto_bruto) || p.bairro;
    const subtotal = itens.reduce((acc, it) => acc + (it.preco * it.qtd), 0);
    const total = subtotal + taxa;

    // Buscar últimos pontos de GPS da rota
    const pontosRota = await db.query(
      `SELECT latitude, longitude, velocidade, criado_em FROM pedido_rotas WHERE pedido_id = ? ORDER BY id ASC`,
      [p.id]
    );

    return res.json(200, {
      success: true,
      pedido: {
        id: p.id,
        numero_pedido: p.numero_pedido,
        status: p.status,
        origem: p.origem || 'MANUAL',
        grupo: p.grupo || null,
        localizador: p.localizador || null,
        cliente: {
          nome: p.cliente || 'Cliente Balcão',
          telefone: p.telefone_cliente || null,
          localizador: p.localizador || null,
          endereco: p.endereco || 'Endereço não informado',
          bairro: bairroFormatado || 'Centro'
        },
        motoboy: p.motoboy_id ? {
          id: p.motoboy_id,
          nome: p.motoboy_nome,
          telefone: p.motoboy_telefone,
          latitude: p.motoboy_lat,
          longitude: p.motoboy_lng
        } : null,
        financeiro: {
          subtotal: Number(subtotal.toFixed(2)),
          taxa_entrega: taxa,
          taxa_repasse: taxa,
          total: Number(total.toFixed(2))
        },
        itens: itens,
        observacoes: p.texto_bruto || 'Sem observações especiais.',
        data_inicio: p.data_inicio,
        data_fim: p.data_fim,
        criado_em: p.criado_em,
        total_pontos_gps: pontosRota.length,
        pontos_rota: pontosRota
      }
    });
  } catch (error) {
    console.error('❌ Erro ao obter detalhes do pedido:', error);
    return res.json(500, { success: false, message: 'Erro ao consultar detalhes do pedido.', error: error.message });
  }
}

/**
 * Rendimentos do Motoboy — Taxas por Bairro (isolado pelo grupo do motoboy)
 * GET /api/motoboy/rendimentos?motoboy_id=<id>&periodo=hoje|ontem|semana|mes|todos
 */
async function obterRendimentosMotoboy(req, res) {
  try {
    const { motoboy_id, periodo = 'hoje' } = req.query || {};

    if (!motoboy_id) {
      return res.json(400, { success: false, message: 'motoboy_id é obrigatório.' });
    }

    const db = getDb();
    const motoboyIdNum = Number(motoboy_id);
    const motoboy = await db.queryOne('SELECT id, nome, grupo FROM motoboys WHERE id = ?', [motoboyIdNum]);
    const grupoMotoboy = (motoboy && motoboy.grupo) ? String(motoboy.grupo).toUpperCase() : 'VELOZ';

    const params = [motoboyIdNum];

    let dataFiltro = '';
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
      case 'todos':
      default:
        dataFiltro = '';
        break;
    }

    const entregas = await db.query(`
      SELECT
        p.id,
        p.numero_pedido,
        p.grupo,
        p.bairro,
        p.endereco,
        p.cliente,
        p.origem,
        p.data_inicio,
        p.data_fim,
        p.texto_bruto
      FROM pedidos p
      WHERE p.motoboy_id = ?
        AND p.status = 'entregue'
        ${dataFiltro}
      ORDER BY p.data_fim DESC
    `, params);

    let totalTaxas = 0;

    const entregasProcessadas = entregas.map(e => {
      const taxaEfetiva = obterTaxaRepasse(e.bairro, e.endereco, e.texto_bruto, grupoMotoboy);
      const bairroNome = obterNomeBairroCanonica(e.bairro, e.endereco, e.texto_bruto) || e.bairro;
      totalTaxas += taxaEfetiva;

      return {
        id: e.id,
        numero_pedido: e.numero_pedido,
        grupo: e.grupo || grupoMotoboy,
        cliente: e.cliente,
        endereco: e.endereco,
        bairro: bairroNome || 'Não informado',
        origem: e.origem,
        data_inicio: e.data_inicio,
        data_fim: e.data_fim,
        taxa_repasse: taxaEfetiva
      };
    });

    const totalEntregas = entregasProcessadas.length;

    return res.json(200, {
      success: true,
      motoboy_id: motoboyIdNum,
      motoboy_grupo: grupoMotoboy,
      periodo,
      taxa_padrao_sem_bairro: grupoMotoboy === 'SPEED' ? 11.00 : 10.00,
      resumo: {
        total_entregas: totalEntregas,
        total_a_receber: Number(totalTaxas.toFixed(2)),
        media_taxa: totalEntregas > 0 ? Number((totalTaxas / totalEntregas).toFixed(2)) : 0
      },
      entregas: entregasProcessadas
    });
  } catch (error) {
    console.error('❌ Erro ao obter rendimentos do motoboy:', error);
    return res.json(500, { success: false, message: 'Erro ao obter rendimentos.', error: error.message });
  }
}

module.exports = {
  webhookSpool,
  definirGrupoPedido,
  listarPedidosDisponiveis,
  assumirPedido,
  iniciarPedido,
  finalizarPedido,
  listarPedidosMotoboy,
  atualizarStatusPedido,
  obterDetalhesPedido,
  obterRendimentosMotoboy,
  expirarPedidosPendentesDiasAnteriores
};
