/**
 * Extrator Regex Inteligente de Comandas (iFood Gestor, 99 Food / 99Store e Cardápio Web)
 * Suporta extração de endereço multilinha completo para GPS de alta precisão.
 */

const BAIRROS_OFICIAIS = [
  'Quinta da Barra', 'Granja Florestal', 'Parque do Imbuí', 'Parque do Imbui', 'Parque Imbuí', 'Parque Imbui',
  'Cascata dos Amores', 'C. das Amores', 'Cascata do Imbuí', 'Cascata do Imbui',
  'C. do Imbuí', 'Fazenda Ermitage', 'F. Ermitage', 'Parque São Luiz', 'Parque Sao Luiz',
  'Parque São Luís', 'Parque Sao Luis', 'Granja Guarani', 'Jardim Serrano', 'Vale do Paraíso',
  'Vale do Paraiso', 'Quebra Frascos', 'Quinta Lebrão', 'Quinta Lebrao', 'Santa Cecília',
  'Santa Cecilia', 'Três Córregos', 'Tres Corregos', 'Vargem Grande', 'Barra do Imbuí',
  'Barra do Imbui', 'Jardim Cascata', 'Jardim Meudon', 'Campo Grande', 'Corta Vento',
  'Fonte Santa', 'Possegueiros', 'Passegueiros', 'Pessegueiros', 'Pimenteiras', 'Vale Feliz',
  'Beira Linha', 'Bom Retiro', 'Fazendinha', 'Rio Lucas', 'Montanhas', 'Paineiras',
  'Panorama', 'Parque Engá', 'Parque Enga', 'Pinheiros', 'Jardim Pinheiros', 'São Pedro', 'Sao Pedro',
  'Vila Muqui', 'Albuquerque', 'Artistas', 'Pimentel', 'Talmaturgo', 'Taumaturgo',
  'Fischer', 'Pedreira', 'Rosário', 'Rosario', 'Soberbo', '40 Casas', 'Quarenta Casas',
  'Agriões', 'Agrioes', 'Araras', 'Caleme', 'Comary', 'Comari', 'Coréia', 'Coreia',
  'Meudon', 'Salaco', 'Tijuca', 'Várzea', 'Varzea', 'Ermitage', 'Prata', 'Posse',
  'Barra', 'Alto', 'Golf', 'Golfe', 'Vale da Revolta', 'Santa Rita', 'Canoas',
  'Regina de Moraes', 'Vale Cedrinhos', 'Vale dos Cedrinhos', 'Bairro de Fátima', 'Bairro de Fatima'
];

function extrairBairroDeTexto(texto) {
  if (!texto || typeof texto !== 'string') return null;
  for (const b of BAIRROS_OFICIAIS) {
    const escaped = b.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
    const rx = new RegExp(`(?:^|[\\s,.-])${escaped}(?=[\\s,.-]|$)`, 'i');
    if (rx.test(texto)) {
      return b;
    }
  }
  return null;
}

function parseComandaTexto(textoBruto) {
  if (!textoBruto || typeof textoBruto !== 'string') return null;

  const texto = textoBruto;
  const textoUpper = texto.toUpperCase();
  const linhas = texto.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);

  // 1. Identificar a Origem e Loja
  let origem = 'BALCAO';
  let loja = null;

  // Detecção de Lojas do Ao Ponto (Comidas Brasileiras, Burgers e Carnes)
  if (textoUpper.includes('COMIDAS BRASILEIRAS') || textoUpper.includes('COMIDA BRASILEIRA')) {
    loja = 'Ao Ponto Comidas Brasileiras';
  } else if (textoUpper.includes('BURGER') || textoUpper.includes('SANDUICH') || textoUpper.includes('SANDUÏCH')) {
    loja = 'Ao Ponto Burgers & Sanduíches';
  } else if (textoUpper.includes('AO PONTO CARNES') || textoUpper.includes('AO PONTO CARNE')) {
    loja = 'Ao Ponto Carnes';
  }

  // Assinatura Inequívoca da 99Food (cobre cabeçalho gráfico, app store ou navegador)
  const is99FoodPattern = 
    /\b99\s*(?:FOOD|ENTREGA|DELIVERY|STORE|APP)\b/i.test(texto) ||
    /\b99FOOD\b/i.test(texto) ||
    /\b99STORE\b/i.test(texto) ||
    textoUpper.includes('NOVE NOVE') ||
    textoUpper.includes('ENTREGA FEITA PELA LOJA') ||
    textoUpper.includes('PREVISAO DE ENTREGA') ||
    textoUpper.includes('PREVISÃO DE ENTREGA') ||
    textoUpper.includes('PREVISÄO DE ENTREGA') ||
    textoUpper.includes('CANCELAR APENAS O QUE ESTÁ EM FALTA') ||
    textoUpper.includes('CANCELAR APENAS O QUE ESTA EM FALTA') ||
    textoUpper.includes('CANCELAR TODO O PEDIDO') ||
    textoUpper.includes('O CLIENTE PRECISA DE TALHERES') ||
    textoUpper.includes('O CLIENTE NÃO PRECISA DE TALHERES') ||
    textoUpper.includes('O CLIENTE NAO PRECISA DE TALHERES') ||
    textoUpper.includes('ENTREGA PROMOCIONAL PARA CLIENTE') ||
    textoUpper.includes('PAGAMENTO VIA 99FOOD') ||
    textoUpper.includes('PAGAMENTO VIA 99 FOOD') ||
    /\bTELEFONE\s*(?:\(0?16\)|\(16\)|016)\b/i.test(texto) ||
    /\bLOCALIZADOR\s*:\s*[0-9]{6,10}\b/i.test(texto) ||
    (loja !== null && !textoUpper.includes('IFOOD') && !textoUpper.includes('CARDAPIO WEB'));

  if (textoUpper.includes('IFOOD')) {
    origem = 'IFOOD';
  } else if (is99FoodPattern) {
    origem = '99FOOD';
  } else if (textoUpper.includes('CARDAPIO WEB') || textoUpper.includes('CARDÁPIO WEB') || textoUpper.includes('CARDAPIOWEB')) {
    origem = 'CARDAPIO_WEB';
  }

  // 2. Extrair Número / ID do Pedido
  let pedidoId = null;

  // Padrão 1: "#1234", "#10", "#01" ou "PEDIDO: #1234" ou "# 1234"
  const matchIdHash = texto.match(/#\s*([0-9]{1,10})\b/);
  // Padrão 2: Número isolado entre linhas de divisórias (muito comum no iFood: "-----\n 0117 \n-----" ou "=====\n 0117 \n=====")
  const matchCentered = texto.match(/[-=*_]{5,}[\r\n]+\s*(?:ENTREGA[\r\n]+\s*)?([0-9]{1,10})\s*[\r\n]+[-=*_]{5,}/i);
  // Padrão 3: "Pedido: 1234", "Pedido 1234", "Pedido de Entrega: 1234", "Nº do Pedido: 1234"
  const matchIdPedido = texto.match(/\b(?:PEDIDO|ORDEM)\s*(?:DE\s+ENTREGA\s*)?(?:N[ºo°.]|DO PEDIDO)?\s*[:#\-]?\s*#?\s*([0-9]{1,10})\b/i);
  // Padrão 4: "Código: 12345" ou "Cód: ABC-123"
  const matchIdCodigo = texto.match(/\b(?:C[ÓOó]DIGO|C[ÓOó]D)\s*[:#]\s*([0-9A-Za-z\-]{1,10})\b/i);
  // Padrão 5: Específico 99 Food isolado
  const match99 = texto.match(/\b99\s*(?:FOOD|ENTREGA)?\s*[:#\-]?\s*#?\s*([0-9]{1,10})\b/i);

  if (matchIdHash) {
    pedidoId = matchIdHash[1];
  } else if (matchCentered) {
    pedidoId = matchCentered[1];
  } else if (matchIdPedido) {
    pedidoId = matchIdPedido[1];
  } else if (match99) {
    pedidoId = match99[1];
    origem = '99FOOD';
  } else if (matchIdCodigo) {
    pedidoId = matchIdCodigo[1];
  }

  // Filtrar palavras comuns que não são números de pedido
  const idsInvalidos = [
    'RESET', 'PRESET', 'ESET', 'NULL', 'TRUE', 'FALSE', 'TEST', 'PAGE', 
    'PRINT', 'DATA', 'START', 'STOP', 'EPSON', 'ING', 'IGO', 'DIGO',
    'ODIGO', 'CODIGO', 'PEDIDO', 'ORDEM', 'ERROR', 'FONT', 'MODE',
    'PAPER', 'FEED', 'CUT', 'OPEN', 'CLOSE', 'INIT', 'CONFIG'
  ];
  if (pedidoId) {
    const pUpper = pedidoId.toUpperCase();
    if (idsInvalidos.includes(pUpper)) {
      pedidoId = null;
    } else if (!/^\d+$/.test(pedidoId) && pedidoId.length < 3) {
      pedidoId = null;
    }
  }

  if (!pedidoId) {
    return null;
  }

  // 3. Extrair Cliente / Nome
  let cliente = null;

  if (origem === '99FOOD') {
    // No 99 Food, o nome do cliente vem logo após o número do pedido "#123456"
    for (let i = 0; i < linhas.length; i++) {
      if (linhas[i].includes(`#${pedidoId}`) || linhas[i].match(new RegExp(`#\\s*${pedidoId}\\b`))) {
        for (let j = i + 1; j < Math.min(i + 4, linhas.length); j++) {
          const cand = linhas[j].trim();
          if (cand.length >= 2 && 
              !cand.startsWith('-') && 
              !cand.startsWith('#') &&
              !cand.match(/^(?:Entrega|Previs|Telefone|Localizador|Endere)/i)) {
            cliente = cand;
            break;
          }
        }
        break;
      }
    }
  } else if (origem === 'IFOOD') {
    // No iFood Gestor, o nome fica entre "pedidos na sua loja" e "0800" / "Endereco:"
    for (let i = 0; i < linhas.length; i++) {
      if (linhas[i].match(/pedidos?\s+na\s+sua\s+loja/i)) {
        for (let j = i + 1; j < Math.min(i + 4, linhas.length); j++) {
          const cand = linhas[j].trim();
          if (cand.length >= 2 && 
              !cand.match(/^0800/) && 
              !cand.match(/^Endere/i) &&
              !cand.match(/^-+$/) &&
              !cand.match(/^\d+$/) &&
              !cand.match(/^ID:/i)) {
            cliente = cand;
            break;
          }
        }
        break;
      }
    }
    // Fallback: Linha anterior a "0800" ou "ID:"
    if (!cliente) {
      for (let i = 0; i < linhas.length; i++) {
        if (linhas[i].match(/^0800.*ID:/i) || linhas[i].match(/\bID:\s*\d/i)) {
          if (i > 0) {
            const cand = linhas[i - 1].trim();
            if (cand.length >= 2 && !cand.match(/^-+$/) && !cand.match(/pedidos?\s+na/i) && !cand.match(/Localizador/i)) {
              cliente = cand;
            }
          }
          break;
        }
      }
    }
  }

  // Fallback Geral para Cliente: Rótulo explícito (excluindo "Cobrar do cliente")
  if (!cliente) {
    const matchClienteLabel = texto.match(/(?<!\bCobrar\s+do\s+)\b(?:Cliente|Nome|Destinat[áa]rio|Entregar para)\s*:\s*([^\n\r]+)/i);
    if (matchClienteLabel) {
      const nomeCandidate = matchClienteLabel[1].trim();
      if (!nomeCandidate.match(/^R\$/) && nomeCandidate.length >= 2) {
        cliente = nomeCandidate;
      }
    }
  }

  // 4. Extração de Endereço Completo & Bairro
  let endereco = null;
  let bairro = null;
  let complemento = null;
  let cidade = 'Teresópolis - RJ';

  if (origem === '99FOOD') {
    // ── 99 FOOD: O endereço é um bloco multilinha após "Endereço:" até a divisória "---"
    const matchBloco99 = texto.match(/Endere[çc]o:\s*([\s\S]*?)(?=\n\s*-{5,}|\n\s*Observa|\n\s*Telefone|\n\s*O cliente|\n\s*$)/i);
    if (matchBloco99) {
      let linhasEnd = matchBloco99[1].split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);
      let rawEnd = linhasEnd.join(' ');

      // Corrigir quebras de palavras feitas pela impressora térmica (ex: "Tere sópolis" -> "Teresópolis")
      rawEnd = rawEnd
        .replace(/Tere\s+s[oó]polis/gi, 'Teresópolis')
        .replace(/\bT\s+eres[oó]polis\b/gi, 'Teresópolis')
        .replace(/\bI\s+mbui\b/gi, 'Imbui')
        .replace(/Barr\s+a\s+do\s+Imbu[íi]/gi, 'Barra do Imbuí')
        .replace(/farma\s+cia/gi, 'farmácia')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .replace(/\s*\.\s*/g, '.')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();

      endereco = rawEnd;

      // Tentar extrair Bairro conhecido da tabela oficial
      const bairroDetectado = extrairBairroDeTexto(endereco);
      if (bairroDetectado) {
        bairro = bairroDetectado;
      }

      // Garantir que a cidade Teresópolis esteja no endereço para o GPS
      if (!/Teres[oó]polis/i.test(endereco)) {
        endereco += ', Teresópolis - RJ';
      }
    }
  } else if (origem === 'IFOOD') {
    // ── IFOOD GESTOR: Campos estruturados linha a linha
    const matchEndLabel = texto.match(/Endere[çc]o:\s*([^\n\r]+)/i);
    const matchComp = texto.match(/\bComp(?:lemento)?:\s*([^\n\r]+)/i);
    const matchBairroIfood = texto.match(/\bBairro:\s*([^\n\r]+)/i);
    const matchRef = texto.match(/\bRef(?:er[êe]ncia)?:\s*([^\n\r]+)/i);
    const matchCidadeIfood = texto.match(/\bCidade:\s*([^\n\r]+)/i);

    const rua = matchEndLabel ? matchEndLabel[1].trim() : null;
    complemento = matchComp ? matchComp[1].trim() : null;
    bairro = matchBairroIfood ? matchBairroIfood[1].trim() : null;
    const ref = matchRef ? matchRef[1].trim() : null;
    const cidadeRaw = matchCidadeIfood ? matchCidadeIfood[1].trim() : null;

    if (rua) {
      let partes = [rua];
      if (complemento) partes.push(complemento);
      if (bairro) partes.push(bairro);
      if (ref) partes.push(`(Ref: ${ref})`);
      if (cidadeRaw) {
        partes.push(cidadeRaw);
      } else {
        partes.push('Teresópolis - RJ');
      }
      endereco = partes.join(', ');
    }
  }

  // Fallback Geral para Endereço
  if (!endereco) {
    const matchEndFallback = texto.match(/(?:Endere[çc]o|Entrega|Entregar em|Destino|Local de entrega):\s*([^\n\r]+)/i);
    if (matchEndFallback) {
      endereco = matchEndFallback[1].trim();
    } else {
      const matchRua = texto.match(/(?:Rua|Av\.|Avenida|Travessa|Alameda|Estrada|Praça)\s+[^\n\r,]+,\s*[0-9]+[^\n\r]*/i);
      if (matchRua) {
        endereco = matchRua[0].trim();
      }
    }
    if (endereco && !/Teres[oó]polis/i.test(endereco)) {
      endereco += ', Teresópolis - RJ';
    }
  }

  // Fallback Geral para Bairro
  if (!bairro) {
    const matchB = texto.match(/\b(?:Bairro|Regi[ãa]o):\s*([^\n\r]+)/i);
    if (matchB) {
      bairro = matchB[1].trim().split('\n')[0].split('-')[0].trim();
    }
    // Se ainda não achou ou não é reconhecido, tenta pela lista de bairros oficiais
    const bOficial = extrairBairroDeTexto(bairro || endereco || texto);
    if (bOficial) {
      bairro = bOficial;
    }
  }

  // 5. Extrair Taxa de Entrega
  let taxaEntrega = 0.0;
  const matchTaxa = texto.match(/(?:Taxa\s*(?:de\s*)?entrega|Tx\s*entrega|Frete|Valor\s*(?:da\s*)?entrega)[\s.:_\-]*R\$\s*([0-9]+[.,][0-9]{2})/i);
  if (matchTaxa) {
    const taxaNum = parseFloat(matchTaxa[1].replace('.', '').replace(',', '.'));
    if (!isNaN(taxaNum)) {
      taxaEntrega = taxaNum;
    }
  }

  // 6. Extrair Localizador e Telefone (0800 iFood, Relay 99Food, WhatsApp ou Direto)
  let localizador = null;
  const matchLoc = texto.match(/\b(?:Localizador|ID)\s*[:#\-]?\s*([0-9]{4}\s*[0-9]{4}|[0-9]{6,10})/i);
  if (matchLoc) {
    localizador = matchLoc[1].replace(/\s+/g, '').trim();
  }

  let telefone = null;
  // 6.1 Telefone 0800 (iFood)
  const match0800 = texto.match(/\b(0800[\s\-]?[0-9]{3}[\s\-]?[0-9]{4})\b/);
  if (match0800) {
    telefone = match0800[1].replace(/\D/g, '');
  }

  // 6.2 Telefone 99Food: "Telefone      (016)23980123"
  if (!telefone) {
    const matchTel99 = texto.match(/Telefone\s*[:\-]?\s*(\(?[0-9]{2,3}\)?\s*[0-9]{4,5}[-\s]?[0-9]{4})/i);
    if (matchTel99) {
      telefone = matchTel99[1].replace(/\D/g, '');
    }
  }

  // 6.3 Telefone convencional / WhatsApp / Cardápio Web
  if (!telefone) {
    const matchTelGeral = texto.match(/(?:Tel(?:efone)?|Cel(?:ular)?|WhatsApp|Whats|Contato)\s*[:\-]?\s*(\(?[0-9]{2,3}\)?\s*[0-9]{4,5}[-\s]?[0-9]{4})/i);
    if (matchTelGeral) {
      telefone = matchTelGeral[1].replace(/\D/g, '');
    }
  }

  // 6.4 Fallback celular com DDD
  if (!telefone) {
    const matchCel = texto.match(/\b(?:\+?55\s*)?\(?([1-9]{2})\)?\s*(9[0-9]{4})[-\s]?([0-9]{4})\b/);
    if (matchCel) {
      telefone = `${matchCel[1]}${matchCel[2]}${matchCel[3]}`;
    }
  }

  // 7. Identificar se o Pedido é para RETIRADA / BALCÃO (não deve ir para motoboys)
  const isRetirada = isComandaRetirada(texto, endereco, taxaEntrega);

  // 8. Extrair Data da Comanda (DD/MM/AAAA ou DD de Mês)
  const dataComanda = extrairDataComanda(texto);

  return {
    origem,
    loja,
    pedidoId: String(pedidoId).trim(),
    cliente: cliente || null,
    endereco: endereco || null,
    bairro: bairro || null,
    taxaEntrega: Number(taxaEntrega || 0),
    telefone: telefone || null,
    localizador: localizador || null,
    textoBruto: texto,
    isRetirada,
    dataComanda: dataComanda || null
  };
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
 * @param {string} textoBruto Texto completo da comanda
 * @param {string} endereco Endereço extraído (se houver)
 * @param {number} taxaEntrega Taxa de entrega cobrada (se houver)
 * @returns {boolean} true se for retirada, false se for entrega
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

module.exports = { parseComandaTexto, isComandaRetirada, extrairDataComanda, extrairBairroDeTexto, BAIRROS_OFICIAIS };
