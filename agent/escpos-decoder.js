/**
 * Decodificador Avançado de Spool (.SPL)
 * Suporta:
 * 1. ESC/POS RAW (com descarte inteligente de payloads binários de imagens raster)
 * 2. Windows EMF Metafiles (extração de registros de texto ExtTextOutW)
 * 3. Varredura profunda de strings ASCII e UTF-16LE
 */

// Tabela de conversão de CP850 (Code Page da Epson TM-T20 no Brasil)
const CP850_MAP = {
  0x80: 'Ç', 0x81: 'ü', 0x82: 'é', 0x83: 'â', 0x84: 'ä', 0x85: 'à', 0x86: 'å', 0x87: 'ç',
  0x88: 'ê', 0x89: 'ë', 0x8A: 'è', 0x8B: 'ï', 0x8C: 'î', 0x8D: 'ì', 0x8E: 'Ä', 0x8F: 'Å',
  0x90: 'É', 0x91: 'æ', 0x92: 'Æ', 0x93: 'ô', 0x94: 'ö', 0x95: 'ò', 0x96: 'û', 0x97: 'ù',
  0x98: 'ÿ', 0x99: 'Ö', 0x9A: 'Ü', 0x9B: 'ø', 0x9C: '£', 0x9D: 'Ø', 0x9E: '×', 0x9F: 'ƒ',
  0xA0: 'á', 0xA1: 'í', 0xA2: 'ó', 0xA3: 'ú', 0xA4: 'ñ', 0xA5: 'Ñ', 0xA6: 'ª', 0xA7: 'º',
  0xC6: 'ã', 0xC7: 'Ã', 0xE5: 'õ', 0xE4: 'Õ'
};

function decodeEscPosBuffer(buffer) {
  if (!buffer || buffer.length === 0) return '';

  // 1. Tentar decodificação ESC/POS com salto estrito de blocos gráficos
  let out = '';
  let i = 0;
  const len = buffer.length;
  let imagensEncontradas = 0;
  let bytesGraficosPulados = 0;

  while (i < len) {
    const byte = buffer[i];

    // Tratar ESC (0x1B)
    if (byte === 0x1B) {
      i++;
      if (i >= len) break;
      const cmd = buffer[i];

      // ESC @ (Initialize)
      if (cmd === 0x40) { i++; continue; }

      // ESC * m nL nH d1...dk (Bit image mode)
      if (cmd === 0x2A) {
        if (i + 3 < len) {
          const m = buffer[i + 1];
          const nL = buffer[i + 2];
          const nH = buffer[i + 3];
          const dotsPerCol = (m === 0 || m === 1) ? 1 : 3;
          const cols = nL + (nH << 8);
          const k = cols * dotsPerCol;
          imagensEncontradas++;
          bytesGraficosPulados += k;
          i += 4 + k;
          continue;
        }
      }

      // Comandos de 2 ou 3 bytes comuns
      if ([0x21, 0x61, 0x64, 0x4A, 0x4D, 0x45, 0x47, 0x74, 0x33, 0x24, 0x5C].includes(cmd)) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Tratar GS (0x1D)
    if (byte === 0x1D) {
      i++;
      if (i >= len) break;
      const cmd = buffer[i];

      // GS v 0 m xL xH yL yH d1...dk (Raster bit image - Epson TM-T20 padrão)
      if (cmd === 0x76 && i + 1 < len && buffer[i + 1] === 0x30) {
        if (i + 6 < len) {
          const xL = buffer[i + 3];
          const xH = buffer[i + 4];
          const yL = buffer[i + 5];
          const yH = buffer[i + 6];
          const bytesWidth = xL + (xH << 8);
          const dotsHeight = yL + (yH << 8);
          const k = bytesWidth * dotsHeight;
          imagensEncontradas++;
          bytesGraficosPulados += k;
          i += 7 + k;
          continue;
        }
      }

      // GS ( L pL pH m fn ... (Graphics data)
      if (cmd === 0x28 && i + 1 < len && buffer[i + 1] === 0x4C) {
        if (i + 3 < len) {
          const pL = buffer[i + 2];
          const pH = buffer[i + 3];
          const k = pL + (pH << 8);
          imagensEncontradas++;
          bytesGraficosPulados += k;
          i += 4 + k;
          continue;
        }
      }

      // GS 8 L p1 p2 p3 p4 m fn ... (Large graphics data)
      if (cmd === 0x38 && i + 1 < len && buffer[i + 1] === 0x4C) {
        if (i + 5 < len) {
          const p1 = buffer[i + 2];
          const p2 = buffer[i + 3];
          const p3 = buffer[i + 4];
          const p4 = buffer[i + 5];
          const k = p1 + (p2 << 8) + (p3 << 16) + (p4 << 24);
          imagensEncontradas++;
          bytesGraficosPulados += k;
          i += 6 + k;
          continue;
        }
      }

      // GS V m [n] (Cut paper)
      if (cmd === 0x56) {
        i++;
        if (i < len && (buffer[i] === 0x41 || buffer[i] === 0x42 || buffer[i] === 0x61 || buffer[i] === 0x62)) {
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      if ([0x21, 0x42, 0x66, 0x48, 0x77, 0x68, 0x4C, 0x57].includes(cmd)) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Tratar FS (0x1C)
    if (byte === 0x1C) {
      i += 2;
      continue;
    }

    // Quebras de linha e tabs
    if (byte === 0x0A || byte === 0x0D) {
      out += '\n';
      i++;
      continue;
    }
    if (byte === 0x09) {
      out += ' ';
      i++;
      continue;
    }

    // Caracteres ASCII imprimíveis (0x20 a 0x7E)
    if (byte >= 0x20 && byte <= 0x7E) {
      out += String.fromCharCode(byte);
      i++;
      continue;
    }

    // Caracteres acentuados CP850
    if (CP850_MAP[byte]) {
      out += CP850_MAP[byte];
      i++;
      continue;
    }

    i++;
  }

  // Se o texto resultante for muito curto ou não tiver palavras legíveis:
  // Fazer uma varredura profunda no buffer para encontrar qualquer frase de texto
  const textoLimpo = out.trim();
  if (textoLimpo.length >= 20 && (textoLimpo.includes('99') || textoLimpo.includes('IFOOD') || textoLimpo.includes('CARDAPIO') || textoLimpo.includes('Pedido') || textoLimpo.includes('PEDIDO') || textoLimpo.includes('Rua') || textoLimpo.includes('Entrega') || textoLimpo.includes('Taxa'))) {
    return textoLimpo;
  }

  // 2. Extração profunda de strings legíveis (ASCII + UTF-16LE do Windows)
  const stringsProfundas = extrairTodasStringsLegiveis(buffer);
  if (stringsProfundas.length > 0) {
    return stringsProfundas.join('\n');
  }

  return textoLimpo;
}

// Extrai todas as palavras ou frases com 3 ou mais caracteres contínuos
function extrairTodasStringsLegiveis(buffer) {
  const achados = [];

  // Busca ASCII
  let seqAscii = '';
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    if ((b >= 32 && b <= 126) || (b >= 160 && b <= 255)) {
      seqAscii += (CP850_MAP[b] || String.fromCharCode(b));
    } else {
      if (seqAscii.trim().length >= 4) {
        achados.push(seqAscii.trim());
      }
      seqAscii = '';
    }
  }
  if (seqAscii.trim().length >= 4) achados.push(seqAscii.trim());

  // Busca UTF-16LE (caractere + 0x00)
  let seqUtf16 = '';
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const b1 = buffer[i];
    const b2 = buffer[i + 1];
    if (b2 === 0 && ((b1 >= 32 && b1 <= 126) || (b1 >= 160 && b1 <= 255))) {
      seqUtf16 += String.fromCharCode(b1);
    } else {
      if (seqUtf16.trim().length >= 4) {
        achados.push(seqUtf16.trim());
      }
      seqUtf16 = '';
    }
  }
  if (seqUtf16.trim().length >= 4) achados.push(seqUtf16.trim());

  return achados;
}

module.exports = { decodeEscPosBuffer, extrairTodasStringsLegiveis };
