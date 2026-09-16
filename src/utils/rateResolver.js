/**
 * Módulo Centralizado de Resolução de Bairros e Taxas de Repasse
 * Suporta as tabelas oficiais dos grupos VELOZ e SPEED
 * Inclui tolerância avançada a quebras de linha de impressoras térmicas (ex: "Al to", "Várz ea", "Ermit ag")
 * e normalização de caracteres de codificação térmica (ex: "Säo Pedro", "Agriöes").
 */

const TABELA_REGRAS = [
  {
    canonical: 'Várzea',
    taxaVeloz: 8.00,
    taxaSpeed: 9.00,
    aliases: ['varzea', 'varz ea', 'varze a', 'vazea', 'vaze a', 'vafea', 'centro', 'varzea x vazea']
  },
  {
    canonical: 'Alto',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['alto', 'al to', 'al-to', 'bairro alto']
  },
  {
    canonical: 'Barra do Imbuí',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['barra do imbui', 'barra do i mbui', 'barra d imbui', 'barra']
  },
  {
    canonical: 'Tijuca',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['tijuca', 'tiju ca']
  },
  {
    canonical: 'Vale do Paraíso',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['vale do paraiso', 'vale do p ar', 'vale do parais o', 'v. paraiso', 'v paraiso', 'v. paraíso', 'vila paraiso', 'vila paraíso']
  },
  {
    canonical: 'Paineiras',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['paineiras', 'paineira', 'paineir as']
  },
  {
    canonical: 'Quinta da Barra',
    taxaVeloz: 12.00,
    taxaSpeed: 11.00,
    aliases: ['quinta da barra', 'q. da barra', 'q da barra', 'quinta d barra']
  },
  {
    canonical: 'Rio Lucas',
    taxaVeloz: 9.00,
    taxaSpeed: 11.00,
    aliases: ['rio lucas', 'lucas', 'r. lucas']
  },
  {
    canonical: 'Araras',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['araras', 'arara s']
  },
  {
    canonical: 'Bairro de Fátima',
    taxaVeloz: 11.00,
    taxaSpeed: 11.00,
    aliases: ['bairro de fatima', 'b. fatima', 'b fatima', 'fatima']
  },
  {
    canonical: 'Beira Linha',
    taxaVeloz: 9.00,
    taxaSpeed: 11.00,
    aliases: ['beira linha', 'b. linha', 'b linha']
  },
  {
    canonical: 'São Pedro',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['sao pedro', 'sao p edro', 'bairro da sao pedro', 'bairro d a sao pedro', 'bairro de sao pedro', 'b. sao pedro']
  },
  {
    canonical: 'Ermitage',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['ermitage', 'ermitge', 'ermit ag', 'ermit age', 'fazenda ermitage', 'f. ermitage', 'f ermitage']
  },
  {
    canonical: 'Quinta Lebrão',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['quinta lebrao', 'q.ta lebrao', 'qta lebrao', 'q. lebrao', 'q lebrao']
  },
  {
    canonical: 'Fonte Santa',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['fonte santa', 'f. santa', 'f santa']
  },
  {
    canonical: 'Jardim Meudon',
    taxaVeloz: 12.00,
    taxaSpeed: 13.00,
    aliases: ['jardim meudon', 'jd. meudon', 'jd meudon']
  },
  {
    canonical: 'Meudon',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['meudon']
  },
  {
    canonical: 'Vale da Revolta',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['vale da revolta', 'v. da revolta', 'v revolta']
  },
  {
    canonical: 'Coréia',
    taxaVeloz: 14.00,
    taxaSpeed: 15.00,
    aliases: ['coreia']
  },
  {
    canonical: 'Prata',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['prata']
  },
  {
    canonical: 'Granja Guarani',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['granja guarani', 'g. guarani', 'g guarani', 'cascata guarani', 'ca sc', 'guarani']
  },
  {
    canonical: 'Pedreira',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['pedreira']
  },
  {
    canonical: 'Soberbo',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['soberbo']
  },
  {
    canonical: 'Parque do Imbuí',
    taxaVeloz: 20.00,
    taxaSpeed: 18.00,
    aliases: ['parque do imbui', 'parque do i mb', 'parque imbui', 'pq. imbui', 'pq imbui']
  },
  {
    canonical: 'Posse',
    taxaVeloz: 25.00,
    taxaSpeed: 18.00,
    aliases: ['posse']
  },
  {
    canonical: 'Caleme',
    taxaVeloz: 25.00,
    taxaSpeed: 18.00,
    aliases: ['caleme']
  },
  {
    canonical: 'Salaco',
    taxaVeloz: 25.00,
    taxaSpeed: 18.00,
    aliases: ['salaco', 'salaço']
  },
  {
    canonical: 'Quebra Frascos',
    taxaVeloz: 20.00,
    taxaSpeed: 18.00,
    aliases: ['quebra frascos', 'q. frascos', 'q frascos']
  },
  {
    canonical: 'Jardim Serrano',
    taxaVeloz: 17.00,
    taxaSpeed: 16.00,
    aliases: ['jardim serrano', 'jd. serrano', 'jd serrano']
  },
  {
    canonical: '40 Casas',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['40 casas', 'quarenta casas']
  },
  {
    canonical: 'Taumaturgo',
    taxaVeloz: 9.00,
    taxaSpeed: 11.00,
    aliases: ['taumaturgo', 'talmaturgo']
  },
  {
    canonical: 'Golfe',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['golfe', 'golf']
  },
  {
    canonical: 'Albuquerque',
    taxaVeloz: 30.00,
    taxaSpeed: 20.00,
    aliases: ['albuquerque']
  },
  {
    canonical: 'Vargem Grande',
    taxaVeloz: 45.00,
    taxaSpeed: 35.00,
    aliases: ['vargem grande']
  },
  {
    canonical: 'Vale Cedrinhos',
    taxaVeloz: 25.00,
    taxaSpeed: 25.00,
    aliases: ['vale cedrinhos', 'vale dos cedrinhos']
  },
  {
    canonical: 'Corta Vento',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['corta vento', 'corta vent o']
  },
  {
    canonical: 'Bom Retiro',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['bom retiro']
  },
  {
    canonical: 'Campo Grande',
    taxaVeloz: 25.00,
    taxaSpeed: 20.00,
    aliases: ['campo grande']
  },
  {
    canonical: 'Pimenteiras',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['pimenteiras']
  },
  {
    canonical: 'Três Córregos',
    taxaVeloz: 30.00,
    taxaSpeed: 20.00,
    aliases: ['tres corregos', 't. corregos', 'tres cor']
  },
  {
    canonical: 'Pessegueiros',
    taxaVeloz: 30.00,
    taxaSpeed: 30.00,
    aliases: ['pessegueiros', 'possegueiros', 'passegueiros']
  },
  {
    canonical: 'Cascata do Imbuí',
    taxaVeloz: 20.00,
    taxaSpeed: 19.00,
    aliases: ['cascata do imbui', 'cascata imbui', 'c. do imbui']
  },
  {
    canonical: 'Montanhas',
    taxaVeloz: 19.00,
    taxaSpeed: 17.00,
    aliases: ['montanhas']
  },
  {
    canonical: 'Santa Rita',
    taxaVeloz: 40.00,
    taxaSpeed: 40.00,
    aliases: ['santa rita']
  },
  {
    canonical: 'Canoas',
    taxaVeloz: 40.00,
    taxaSpeed: 40.00,
    aliases: ['canoas']
  },
  {
    canonical: 'Regina de Moraes',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['regina de moraes']
  },
  {
    canonical: 'Pinheiros',
    taxaVeloz: 10.00,
    taxaSpeed: 13.00,
    aliases: ['pinheiros', 'jardim pinheiros', 'jd pinheiros', 'jd. pinheiros', 'jd pinheiros (final)']
  },
  {
    canonical: 'Agriões',
    taxaVeloz: 7.00,
    taxaSpeed: 7.00,
    aliases: ['agrioes', 'agriões']
  },
  {
    canonical: 'Comary',
    taxaVeloz: 13.00,
    taxaSpeed: 13.00,
    aliases: ['comary', 'comari']
  },
  {
    canonical: 'Santa Cecília',
    taxaVeloz: 12.00,
    taxaSpeed: 12.00,
    aliases: ['santa cecilia']
  },
  {
    canonical: 'Artistas',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['artistas', 'artista s', 'art is']
  },
  {
    canonical: 'Fazendinha',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['fazendinha']
  },
  {
    canonical: 'Panorama',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['panorama']
  },
  {
    canonical: 'Vila Muqui',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['vila muqui']
  },
  {
    canonical: 'Pimentel',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['pimentel']
  },
  {
    canonical: 'Parque São Luiz',
    taxaVeloz: 10.00,
    taxaSpeed: 11.00,
    aliases: ['parque sao luiz', 'parque sao luis', 'parque sao l']
  },
  {
    canonical: 'Rosário',
    taxaVeloz: 12.00,
    taxaSpeed: 12.00,
    aliases: ['rosario']
  },
  {
    canonical: 'Cascata dos Amores',
    taxaVeloz: 12.00,
    taxaSpeed: 12.00,
    aliases: ['cascata dos amores', 'cascata do s', 'c. das amores']
  },
  {
    canonical: 'Granja Florestal',
    taxaVeloz: 25.00,
    taxaSpeed: 25.00,
    aliases: ['granja florestal']
  },
  {
    canonical: 'Vale Feliz',
    taxaVeloz: 30.00,
    taxaSpeed: 30.00,
    aliases: ['vale feliz']
  }
];

/**
 * Normaliza strings para busca fonética e sem acentos
 */
function normalizarTextoBusca(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .replace(/[äÄ]/g, 'a')
    .replace(/[ëË]/g, 'e')
    .replace(/[ïÏ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[üÜ]/g, 'u')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identifica a regra do bairro a partir do bairro explícito, endereço ou texto da comanda
 */
function identificarRegraBairro(bairroStr, enderecoStr, textoBrutoStr) {
  const fontes = [bairroStr, enderecoStr, textoBrutoStr]
    .filter(f => f && typeof f === 'string' && f.trim() !== '' && f.trim() !== 'null' && f.trim() !== 'undefined');

  for (const fonte of fontes) {
    const n = normalizarTextoBusca(fonte);
    if (!n) continue;

    for (const r of TABELA_REGRAS) {
      for (const alias of r.aliases) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`(?:^|[\\s,.;/\\-])${escaped}(?=[\\s,.;/\\-]|$)`, 'i');
        if (rx.test(n)) {
          return r;
        }
      }
    }
  }

  return null;
}

/**
 * Retorna o nome canônico do bairro identificado
 */
function obterNomeBairroCanonica(bairroStr, enderecoStr, textoBrutoStr) {
  const r = identificarRegraBairro(bairroStr, enderecoStr, textoBrutoStr);
  if (r) return r.canonical;
  if (bairroStr && typeof bairroStr === 'string' && bairroStr.trim() !== 'null' && bairroStr.trim() !== '') {
    return bairroStr.trim();
  }
  return 'Centro / Não informado';
}

/**
 * Calcula a taxa de repasse oficial e inquestionável baseada no grupo
 * @param {string} bairroStr - Bairro registrado
 * @param {string} enderecoStr - Endereço completo
 * @param {string} textoBrutoStr - Texto da comanda
 * @param {string} grupo - 'SPEED' ou 'VELOZ'
 * @returns {number} Taxa em Reais
 */
function obterTaxaRepasse(bairroStr, enderecoStr, textoBrutoStr, grupo) {
  const cleanGrupo = String(grupo || 'VELOZ').toUpperCase();
  const r = identificarRegraBairro(bairroStr, enderecoStr, textoBrutoStr);

  if (cleanGrupo === 'SPEED') {
    if (!r) return 11.00; // Padrão da Tabela Speed para zona urbana geral (NUNCA usa Veloz)
    return r.taxaSpeed;
  } else {
    if (!r) return 10.00; // Padrão da Tabela Veloz para zona urbana geral
    return r.taxaVeloz;
  }
}

module.exports = {
  TABELA_REGRAS,
  normalizarTextoBusca,
  identificarRegraBairro,
  obterNomeBairroCanonica,
  obterTaxaRepasse
};
