const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Módulo de extração de imagens de comandas térmicas Epson TM-T20
 * Suporta:
 * 1. EMF (Windows Metafile GDI)
 * 2. GS 8 L (Function 112 / 67 - padrão moderno Epson APD para impressões grandes)
 * 3. GS ( L (Function 112 / 67 - padrão moderno Epson APD)
 * 4. GS v 0 (modo raster bit image clássico)
 * 5. ESC * (fatias de bit-image de 24-dot ou 8-dot)
 * 6. Heurística de varredura bruta de raster
 */

function ehEmf(buffer) {
  return buffer && buffer.length >= 44 && buffer.readUInt32LE(0) === 1 && buffer.slice(40, 44).toString('ascii') === ' EMF';
}

/**
 * Monta um arquivo BMP monocromático (1 bit por pixel) compatível com o Windows OCR
 */
function montarBmp(rawData, bytesWidth, totalHeight) {
  const larguraPixels = bytesWidth * 8;
  const paddedBytesPerRow = Math.ceil(bytesWidth / 4) * 4;
  const imageSize = paddedBytesPerRow * totalHeight;
  const fileSize = 62 + imageSize;

  const bmp = Buffer.alloc(fileSize);
  bmp.write('BM', 0);
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(0, 6);
  bmp.writeUInt32LE(62, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(larguraPixels, 18);
  bmp.writeInt32LE(-totalHeight, 22); // altura negativa = top-down
  bmp.writeUInt16LE(1, 26); // planos = 1
  bmp.writeUInt16LE(1, 28); // bits por pixel = 1 (monocromático)
  bmp.writeUInt32LE(0, 30); // compressão BI_RGB = 0
  bmp.writeUInt32LE(imageSize, 34);
  bmp.writeInt32LE(8000, 38);
  bmp.writeInt32LE(8000, 42);
  bmp.writeUInt32LE(2, 46);
  bmp.writeUInt32LE(2, 50);

  // Paleta monocromática: 0 = Branco, 1 = Preto
  bmp[54] = 0xFF; bmp[55] = 0xFF; bmp[56] = 0xFF; bmp[57] = 0x00; // Índice 0: Branco
  bmp[58] = 0x00; bmp[59] = 0x00; bmp[60] = 0x00; bmp[61] = 0x00; // Índice 1: Preto

  let offset = 62;
  for (let y = 0; y < totalHeight; y++) {
    const srcStart = y * bytesWidth;
    const srcEnd = srcStart + bytesWidth;
    if (srcStart < rawData.length) {
      rawData.copy(bmp, offset, srcStart, Math.min(srcEnd, rawData.length));
    }
    offset += paddedBytesPerRow;
  }
  return { bmp, larguraPixels, alturaTotal: totalHeight };
}

/**
 * Converte fatias verticais de ESC * (modo 33: 24-dot double density) em raster horizontal
 */
function converterEscStarParaRaster(fatias) {
  if (!fatias || fatias.length === 0) return null;

  let maxCols = 0;
  for (const f of fatias) {
    if (f.cols > maxCols) maxCols = f.cols;
  }
  if (maxCols === 0) return null;

  const bytesWidth = Math.ceil(maxCols / 8);
  const totalHeight = fatias.reduce((acc, f) => acc + (f.is24 ? 24 : 8), 0);
  const rawData = Buffer.alloc(bytesWidth * totalHeight, 0);

  let currentY = 0;
  for (const f of fatias) {
    const cols = f.cols;
    const is24 = f.is24;
    const data = f.data;

    if (is24) {
      // 24 dots = 3 bytes por coluna: byte0 (dots 0-7), byte1 (dots 8-15), byte2 (dots 16-23)
      for (let dotY = 0; dotY < 24; dotY++) {
        const y = currentY + dotY;
        const rowOffset = y * bytesWidth;
        const byteIndexInCol = Math.floor(dotY / 8);
        const bitMaskInByte = 1 << (7 - (dotY % 8));

        for (let col = 0; col < cols; col++) {
          const colDataIndex = col * 3 + byteIndexInCol;
          if (colDataIndex < data.length) {
            const val = data[colDataIndex];
            if ((val & bitMaskInByte) !== 0) {
              const targetByte = rowOffset + Math.floor(col / 8);
              const targetBit = 7 - (col % 8);
              rawData[targetByte] |= (1 << targetBit);
            }
          }
        }
      }
      currentY += 24;
    } else {
      // 8 dots = 1 byte por coluna
      for (let dotY = 0; dotY < 8; dotY++) {
        const y = currentY + dotY;
        const rowOffset = y * bytesWidth;
        const bitMaskInByte = 1 << (7 - dotY);

        for (let col = 0; col < cols; col++) {
          if (col < data.length) {
            const val = data[col];
            if ((val & bitMaskInByte) !== 0) {
              const targetByte = rowOffset + Math.floor(col / 8);
              const targetBit = 7 - (col % 8);
              rawData[targetByte] |= (1 << targetBit);
            }
          }
        }
      }
      currentY += 8;
    }
  }

  return { rawData, bytesWidth, totalHeight };
}

/**
 * Analisa e extrai todos os blocos gráficos ESC/POS presentes no buffer
 */
function extrairRasterEpson(buffer) {
  if (!buffer || buffer.length === 0) return null;

  // 1. Se for EMF direto do Windows
  if (ehEmf(buffer)) {
    return { isEmf: true, buffer };
  }

  const len = buffer.length;

  // 2. Procurar comandos GS 8 L (Function 112 ou 67)
  // Estrutura: 1D 38 4C p1 p2 p3 p4 m fn a bx by c xL xH yL yH d1...dk
  const blocosGs8L = [];
  for (let i = 0; i <= len - 17; i++) {
    if (buffer[i] === 0x1D && buffer[i + 1] === 0x38 && buffer[i + 2] === 0x4C) {
      const pLen = buffer[i + 3] + (buffer[i + 4] << 8) + (buffer[i + 5] << 16) + (buffer[i + 6] * 16777216);
      const m = buffer[i + 7];
      const fn = buffer[i + 8];

      // fn = 112 (0x70) ou fn = 67 (0x43)
      if (fn === 0x70 || fn === 0x43 || fn === 112 || fn === 67) {
        const xL = buffer[i + 13];
        const xH = buffer[i + 14];
        const yL = buffer[i + 15];
        const yH = buffer[i + 16];
        const dotsWidth = xL + (xH << 8);
        const dotsHeight = yL + (yH << 8);
        const bytesWidth = Math.ceil(dotsWidth / 8);
        const dataSize = bytesWidth * dotsHeight;
        const dataStart = i + 17;

        if (bytesWidth > 10 && bytesWidth <= 120 && dotsHeight > 0 && dataStart + dataSize <= len + 100) {
          const sliceEnd = Math.min(len, dataStart + dataSize);
          blocosGs8L.push({
            bytesWidth,
            dotsHeight,
            data: buffer.slice(dataStart, sliceEnd)
          });
          i = sliceEnd - 1; // avançar ponteiro
        }
      }
    }
  }

  if (blocosGs8L.length > 0) {
    const totalHeight = blocosGs8L.reduce((a, b) => a + b.dotsHeight, 0);
    const largura = blocosGs8L[0].bytesWidth;
    const rawConcat = Buffer.concat(blocosGs8L.map(b => b.data));
    const result = montarBmp(rawConcat, largura, totalHeight);
    result.isEmf = false;
    result.metodo = 'GS_8_L';
    return result;
  }

  // 3. Procurar comandos GS ( L (Function 112 ou 67)
  // Estrutura: 1D 28 4C pL pH m fn a bx by c xL xH yL yH d1...dk
  const blocosGsL = [];
  for (let i = 0; i <= len - 15; i++) {
    if (buffer[i] === 0x1D && buffer[i + 1] === 0x28 && buffer[i + 2] === 0x4C) {
      const pLen = buffer[i + 3] + (buffer[i + 4] << 8);
      const m = buffer[i + 5];
      const fn = buffer[i + 6];

      if (fn === 0x70 || fn === 0x43 || fn === 112 || fn === 67) {
        const xL = buffer[i + 11];
        const xH = buffer[i + 12];
        const yL = buffer[i + 13];
        const yH = buffer[i + 14];
        const dotsWidth = xL + (xH << 8);
        const dotsHeight = yL + (yH << 8);
        const bytesWidth = Math.ceil(dotsWidth / 8);
        const dataSize = bytesWidth * dotsHeight;
        const dataStart = i + 15;

        if (bytesWidth > 10 && bytesWidth <= 120 && dotsHeight > 0) {
          const sliceEnd = Math.min(len, dataStart + dataSize);
          blocosGsL.push({
            bytesWidth,
            dotsHeight,
            data: buffer.slice(dataStart, sliceEnd)
          });
          i = sliceEnd - 1;
        }
      }
    }
  }

  if (blocosGsL.length > 0) {
    const totalHeight = blocosGsL.reduce((a, b) => a + b.dotsHeight, 0);
    const largura = blocosGsL[0].bytesWidth;
    const rawConcat = Buffer.concat(blocosGsL.map(b => b.data));
    const result = montarBmp(rawConcat, largura, totalHeight);
    result.isEmf = false;
    result.metodo = 'GS_L';
    return result;
  }

  // 4. Procurar comandos GS v 0 (modo raster bit image)
  // Estrutura: 1D 76 30 m xL xH yL yH d1...dk
  const blocosGsv0 = [];
  for (let i = 0; i <= len - 8; i++) {
    if (buffer[i] === 0x1D && buffer[i + 1] === 0x76 && (buffer[i + 2] === 0x30 || buffer[i + 2] === 0x00)) {
      const m = buffer[i + 3];
      const xL = buffer[i + 4];
      const xH = buffer[i + 5];
      const yL = buffer[i + 6];
      const yH = buffer[i + 7];
      const bytesWidth = xL + (xH << 8);
      const dotsHeight = yL + (yH << 8);
      const dataSize = bytesWidth * dotsHeight;
      const dataStart = i + 8;

      if (bytesWidth >= 20 && bytesWidth <= 120 && dotsHeight > 0 && dotsHeight < 10000) {
        const sliceEnd = Math.min(len, dataStart + dataSize);
        blocosGsv0.push({
          bytesWidth,
          dotsHeight,
          data: buffer.slice(dataStart, sliceEnd)
        });
        i = sliceEnd - 1;
      }
    }
  }

  if (blocosGsv0.length > 0) {
    const totalHeight = blocosGsv0.reduce((a, b) => a + b.dotsHeight, 0);
    const largura = blocosGsv0[0].bytesWidth;
    const rawConcat = Buffer.concat(blocosGsv0.map(b => b.data));
    const result = montarBmp(rawConcat, largura, totalHeight);
    result.isEmf = false;
    result.metodo = 'GS_v_0';
    return result;
  }

  // 5. Procurar fatias ESC * (Bit Image Mode - 24 dots ou 8 dots)
  // Estrutura: 1B 2A m nL nH d1...dk
  const fatiasEscStar = [];
  for (let i = 0; i <= len - 5; i++) {
    if (buffer[i] === 0x1B && buffer[i + 1] === 0x2A) {
      const m = buffer[i + 2];
      const nL = buffer[i + 3];
      const nH = buffer[i + 4];
      const cols = nL + (nH << 8);
      const is24 = (m === 32 || m === 33 || m === 38 || m === 39);
      const bytesPerCol = is24 ? 3 : 1;
      const dataSize = cols * bytesPerCol;
      const dataStart = i + 5;

      if (cols >= 100 && cols <= 1000 && dataStart + dataSize <= len + 10) {
        const sliceEnd = Math.min(len, dataStart + dataSize);
        fatiasEscStar.push({
          cols,
          is24,
          data: buffer.slice(dataStart, sliceEnd)
        });
        i = sliceEnd - 1;
      }
    }
  }

  if (fatiasEscStar.length >= 2) {
    const converted = converterEscStarParaRaster(fatiasEscStar);
    if (converted && converted.totalHeight > 20) {
      const result = montarBmp(converted.rawData, converted.bytesWidth, converted.totalHeight);
      result.isEmf = false;
      result.metodo = 'ESC_STAR';
      return result;
    }
  }

  // 6. Heurística de fallback: extração bruta de raster térmico (72 bytes por linha = 576 dots)
  if (buffer.length >= 1000) {
    let skip = 0;
    // Pular comandos de inicialização iniciais (< 120 bytes)
    for (let i = 0; i < Math.min(120, buffer.length); i++) {
      if (buffer[i] === 0x1B || buffer[i] === 0x1D) {
        skip = i + 3;
      }
    }
    const raw = buffer.slice(skip);
    const largura = 72; // 80mm padrão Epson
    const altura = Math.floor(raw.length / largura);
    if (altura >= 50) {
      const result = montarBmp(raw, largura, altura);
      result.isEmf = false;
      result.metodo = 'BRUTO_72';
      return result;
    }
  }

  return null;
}

/**
 * Executa OCR nativo do Windows em um arquivo de imagem (BMP, PNG) ou EMF
 */
function executarOcrEmArquivo(caminhoArquivo) {
  const scriptOcr = path.join(__dirname, 'executar_ocr.ps1');
  if (!fs.existsSync(scriptOcr)) {
    console.error('Script executar_ocr.ps1 não encontrado em:', scriptOcr);
    return '';
  }

  try {
    const cmd = `powershell -ExecutionPolicy Bypass -File "${scriptOcr}" -ImagePath "${caminhoArquivo}"`;
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 20000 });
    const match = stdout.match(/---OCR_START---([\s\S]*?)---OCR_END---/);
    if (match) {
      return match[1].trim();
    }
    if (stdout.includes('OCR_ERROR')) {
      console.error('Aviso OCR Windows:', stdout.trim());
    }
  } catch (err) {
    console.error('Erro ao executar OCR nativo:', err.message);
  }
  return '';
}

/**
 * Função de diagnóstico para inspecionar os comandos gráficos dentro de um buffer
 */
function analisarComandosGraficos(buffer) {
  const resultado = { emf: false, gs8L: 0, gsL: 0, gsv0: 0, escStar: 0, totalBytes: buffer ? buffer.length : 0 };
  if (!buffer) return resultado;
  resultado.emf = ehEmf(buffer);
  const len = buffer.length;
  for (let i = 0; i < len - 4; i++) {
    if (buffer[i] === 0x1D && buffer[i + 1] === 0x38 && buffer[i + 2] === 0x4C) resultado.gs8L++;
    if (buffer[i] === 0x1D && buffer[i + 1] === 0x28 && buffer[i + 2] === 0x4C) resultado.gsL++;
    if (buffer[i] === 0x1D && buffer[i + 1] === 0x76 && buffer[i + 2] === 0x30) resultado.gsv0++;
    if (buffer[i] === 0x1B && buffer[i + 1] === 0x2A) resultado.escStar++;
  }
  return resultado;
}

module.exports = {
  ehEmf,
  extrairRasterEpson,
  executarOcrEmArquivo,
  analisarComandosGraficos,
  montarBmp
};
