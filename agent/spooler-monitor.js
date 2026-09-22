const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const net = require('net');
const { execSync } = require('child_process');
const { decodeEscPosBuffer } = require('./escpos-decoder');
const { parseComandaTexto } = require('./comanda-parser');
const { extrairRasterEpson, executarOcrEmArquivo } = require('./raster-ocr');

// ── Garantir Instância Única (Evita 2 instâncias simultâneas do monitor) ─────
const LOCK_PORT = 54321;
const lockServer = net.createServer();
lockServer.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('⚠️ Já existe uma instância do Spooler Monitor em execução neste computador. Encerrando para evitar duplicação.');
    process.exit(0);
  }
});
lockServer.listen(LOCK_PORT, '127.0.0.1');

// ── Sistema de Log Duplo (Console + Arquivo monitor.log) ──────────────────────
const logFilePath = path.join(__dirname, 'monitor.log');
function log(msg) {
  const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(logFilePath, line + '\n', 'utf8');
  } catch (e) {}
}

// ── Carregar Configurações ──────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json');
let config = {
  spool_dir: 'C:\\Windows\\System32\\spool\\PRINTERS',
  api_url: 'https://sistrastreamento.vercel.app/api/pedidos/webhook-spool',
  api_secret: 'balcao_secret_token_aoponto_2026',
  poll_interval_ms: 500,
  delete_processed_files: false,
  archive_dir: path.join(__dirname, 'processados')
};

if (fs.existsSync(configPath)) {
  try {
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...userConfig };
  } catch (err) {
    log('⚠️ Erro ao ler config.json, usando configurações padrão.');
  }
}

// Ativar automaticamente KeepPrintedJobs em todas as impressoras
try {
  execSync('powershell -Command "Get-Printer | Set-Printer -KeepPrintedJobs:1"', { stdio: 'ignore' });
  log('✅ Retenção de impressão (KeepPrintedJobs) garantida nas impressoras.');
} catch (e) {}

// ── Cache Local Anti-Duplicação ──────────────────────────────────────────────
const cachePath = path.join(__dirname, 'processed_cache.json');
let processedCache = new Set();

if (fs.existsSync(cachePath)) {
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (Array.isArray(data)) {
      processedCache = new Set(data);
    }
  } catch (err) {
    processedCache = new Set();
  }
}

function salvarCache() {
  try {
    const arr = Array.from(processedCache).slice(-500);
    fs.writeFileSync(cachePath, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    log(`⚠️ Falha ao salvar cache: ${err.message}`);
  }
}

// ── Envio HTTP para a API na Vercel ──────────────────────────────────────────
function enviarPedidoParaApi(pedidoData) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(pedidoData);
    const parsedUrl = new URL(config.api_url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${config.api_secret}`
      },
      timeout: 10000
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ statusCode: res.statusCode, data: json });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de conexão com o servidor'));
    });

    req.write(payload);
    req.end();
  });
}

// ── Processamento de Arquivos de Impressão (.SPL) ───────────────────────────
let isScanning = false;
// Mutex: impede que dois arquivos com o mesmo pedido sejam processados ao mesmo tempo
const pedidosEmProcessamento = new Set();
// Rastreamento de tentativas por arquivo para evitar cache prematuro de arquivos sendo gravados
const arquivosPendentes = new Map(); // fileName -> { tentativas: number, ultimoTamanho: number }

async function processarArquivoSpool(filePath) {
  const fileName = path.basename(filePath);
  const cacheKeyFile = `FILE_${fileName}`;

  // Ignorar arquivos .TMP, .SHD e arquivos já processados definitivamente
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.tmp' || ext === '.shd') return;
  if (processedCache.has(cacheKeyFile)) return;

  // Ignorar arquivos de impressão criados há mais de 18 horas (segurança contra spool antigo retido)
  try {
    const stat = fs.statSync(filePath);
    const limiteHoras = 18 * 60 * 60 * 1000;
    if (Date.now() - stat.mtimeMs > limiteHoras) {
      processedCache.add(cacheKeyFile);
      arquivosPendentes.delete(fileName);
      return;
    }
  } catch (e) {}

  // Tentar ler o arquivo aguardando o fim da gravação pelo Windows
  let fileBuffer = null;
  for (let tentativa = 1; tentativa <= 15; tentativa++) {
    try {
      if (fs.existsSync(filePath)) {
        fileBuffer = fs.readFileSync(filePath);
        if (fileBuffer && fileBuffer.length > 0) break;
      }
    } catch (err) {
      // EBUSY ou EPERM temporário enquanto o Windows Spooler grava
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Se não conseguiu ler ou arquivo tem menos de 10 bytes, NÃO descartar imediatamente!
  // O Windows pode estar iniciando o spooling do documento agora.
  if (!fileBuffer || fileBuffer.length < 10) {
    const pendente = arquivosPendentes.get(fileName) || { tentativas: 0, ultimoTamanho: 0 };
    pendente.tentativas++;
    arquivosPendentes.set(fileName, pendente);

    // Só descarta se passou de 10 ciclos completos (5 segundos) sem nenhum byte gravado
    if (pendente.tentativas >= 10) {
      processedCache.add(cacheKeyFile);
      arquivosPendentes.delete(fileName);
    }
    return;
  }

  // 1. Tentar decodificar texto ESC/POS direto (iFood Gestor, Cardápio Web, 99Food texto)
  let textoLimpo = decodeEscPosBuffer(fileBuffer);
  let parsed = parseComandaTexto(textoLimpo);

  // 2. Se não encontrou pedido no texto, verificar se é imagem gráfica ou EMF (ex: 99 Food no Edge/Chrome)
  if (!parsed || !parsed.pedidoId) {
    const raster = extrairRasterEpson(fileBuffer);
    if (raster) {
      const tempPath = raster.isEmf 
        ? path.join(__dirname, `temp_comanda_${Date.now()}.spl`)
        : path.join(__dirname, `temp_comanda_${Date.now()}.bmp`);

      if (raster.isEmf) {
        log(`🖼️ Comanda em formato vetorial Windows EMF detectada em [${fileName}]. Executando OCR...`);
      } else {
        log(`🖼️ Comanda gráfica detectada em [${fileName}] (${raster.larguraPixels}x${raster.alturaTotal}px). Executando OCR nativo...`);
      }

      try {
        fs.writeFileSync(tempPath, raster.isEmf ? raster.buffer : raster.bmp);
        const textoOcr = executarOcrEmArquivo(tempPath);
        if (textoOcr) {
          const parsedOcr = parseComandaTexto(textoOcr);
          if (parsedOcr && parsedOcr.pedidoId) {
            parsed = parsedOcr;
            textoLimpo = textoOcr;
            log(`🎯 Pedido identificado via OCR: ${parsed.origem} #${parsed.pedidoId}!`);
          }
        }
      } catch (e) {
        log(`⚠️ Falha ao executar OCR: ${e.message}`);
      } finally {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
        const pngTemp = tempPath.replace(/\.(spl|bmp)$/, '.rendered.png');
        try { if (fs.existsSync(pngTemp)) fs.unlinkSync(pngTemp); } catch (e) {}
      }
    }
  }

  // Se ainda assim não encontrou pedidoId, verificar se o arquivo ainda está crescendo
  if (!parsed || !parsed.pedidoId) {
    const pendente = arquivosPendentes.get(fileName) || { tentativas: 0, ultimoTamanho: 0 };
    pendente.tentativas++;

    const tamanhoAtual = fileBuffer.length;
    const aindaCrescendo = tamanhoAtual !== pendente.ultimoTamanho;
    pendente.ultimoTamanho = tamanhoAtual;
    arquivosPendentes.set(fileName, pendente);

    // Se o arquivo ainda está recebendo bytes ou ainda não deu 10 ciclos de tentativas, aguarda
    if (aindaCrescendo || pendente.tentativas < 10) {
      return;
    }

    // Após 10 ciclos sem mudança de tamanho e sem pedido detectado, ignora definitivamente
    processedCache.add(cacheKeyFile);
    arquivosPendentes.delete(fileName);
    return;
  }

  // ── FILTRO 99FOOD: Integração direta via API/Webhook ativada ──
  // A 99Food agora é recebida oficialmente via API. O spooler processa apenas iFood.
  if (parsed.origem === '99FOOD') {
    log(`ℹ️ Pedido 99Food #${parsed.pedidoId} ignorado no spooler (agora integrado via API/Webhook oficial). [${fileName}]`);
    processedCache.add(cacheKeyFile);
    arquivosPendentes.delete(fileName);
    salvarCache();
    return;
  }

  // ── FILTRO DE RETIRADA / BALCÃO ──────────────────────────────────────
  if (parsed.isRetirada) {
    log(`ℹ️ Pedido ${parsed.origem} #${parsed.pedidoId} é para RETIRADA NO LOCAL (não requer motoboy). Ignorando [${fileName}].`);
    processedCache.add(cacheKeyFile);
    arquivosPendentes.delete(fileName);
    salvarCache();
    return;
  }

  // ── ANTI-DUPLICAÇÃO E DESCARTE DE COMANDAS DE DATAS ANTERIORES ──────────────
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  // Se a comanda contém data explícita e for de data anterior a hoje, descartar imediatamente
  if (parsed.dataComanda && parsed.dataComanda < hojeStr) {
    log(`⏳ Comanda de data anterior descartada: ${parsed.origem} #${parsed.pedidoId} (${parsed.dataComanda} anterior a hoje ${hojeStr}). Ignorando [${fileName}].`);
    processedCache.add(cacheKeyFile);
    arquivosPendentes.delete(fileName);
    salvarCache();
    return;
  }

  const dataRef = parsed.dataComanda || hojeStr;
  const cacheKeyOrder = `${parsed.origem}_${parsed.pedidoId}_${dataRef}`;

  // Verificar se já está no cache OU se está sendo processado agora por outro arquivo
  if (processedCache.has(cacheKeyOrder) || pedidosEmProcessamento.has(cacheKeyOrder)) {
    log(`ℹ️ Pedido ${parsed.origem} #${parsed.pedidoId} já enviado/em processamento na data ${dataRef}. Ignorando arquivo [${fileName}].`);
    processedCache.add(cacheKeyFile);
    arquivosPendentes.delete(fileName);
    salvarCache();
    return;
  }

  // Marcar como "em processamento" IMEDIATAMENTE (antes do HTTP)
  pedidosEmProcessamento.add(cacheKeyOrder);

  log(`======================================================`);
  log(`📄 NOVA COMANDA DETECTADA [${fileName}]`);
  log(` Origem:   ${parsed.origem}`);
  log(` Pedido:   #${parsed.pedidoId}`);
  log(` Cliente:  ${parsed.cliente || 'Não informado'}`);
  log(` Endereço: ${parsed.endereco || 'Não informado'}`);
  log(` Taxa:     R$ ${parsed.taxaEntrega.toFixed(2)}`);
  log(`======================================================`);

  try {
    log(`🚀 Enviando para API (${config.api_url})...`);
    const resp = await enviarPedidoParaApi(parsed);

    if (resp.statusCode === 201) {
      log(`✅ Sucesso! Pedido #${parsed.pedidoId} liberado automaticamente para os motoboys.`);
      processedCache.add(cacheKeyOrder);
      processedCache.add(cacheKeyFile);
      arquivosPendentes.delete(fileName);
      salvarCache();

      if (config.delete_processed_files) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    } else if (resp.statusCode === 200 && resp.data && resp.data.duplicado) {
      log(`ℹ️ Pedido #${parsed.pedidoId} já constava no banco de dados. Sincronizado.`);
      processedCache.add(cacheKeyOrder);
      processedCache.add(cacheKeyFile);
      arquivosPendentes.delete(fileName);
      salvarCache();
    } else if (resp.statusCode === 202 || (resp.data && resp.data.descartado)) {
      log(`⚠️ Aviso: Pedido #${parsed.pedidoId} descartado pela API (${resp.data?.motivo || 'regra de negócio'}): ${resp.data?.message}`);
      processedCache.add(cacheKeyOrder);
      processedCache.add(cacheKeyFile);
      arquivosPendentes.delete(fileName);
      salvarCache();
    } else {
      log(`⚠️ API retornou status ${resp.statusCode}: ${JSON.stringify(resp.data || resp.raw)}`);
      // Em erro de rede/servidor, não marca no cache para retentar no próximo ciclo
    }
  } catch (err) {
    log(`❌ Erro ao enviar comanda para API: ${err.message}`);
  } finally {
    // Liberar o mutex após concluir (com ou sem erro)
    pedidosEmProcessamento.delete(cacheKeyOrder);
  }
}

async function varrerSpool() {
  if (isScanning) return;
  isScanning = true;

  try {
    if (!fs.existsSync(config.spool_dir)) {
      isScanning = false;
      return;
    }

    const files = fs.readdirSync(config.spool_dir);
    // Filtrar apenas .SPL, ignorar .SHD e .TMP
    const splFiles = files.filter(f => f.toLowerCase().endsWith('.spl'));

    // Processar SEQUENCIALMENTE para garantir anti-duplicação
    for (const file of splFiles) {
      const fullPath = path.join(config.spool_dir, file);
      await processarArquivoSpool(fullPath);
    }
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      log(`❌ ERRO DE PERMISSÃO: Acesso negado à pasta ${config.spool_dir}. O programa PRECISA rodar como Administrador!`);
    } else {
      log(`❌ Erro ao varrer pasta de spool: ${err.message}`);
    }
  } finally {
    isScanning = false;
  }
}

// ── Inicialização ──────────────────────────────────────────────────────────
log(`=============================================================`);
log(`   🖨️ AGENTE SPOOLER BALCÃO - EPSON TM-T20 (MONITOR ATIVO)   `);
log(`=============================================================`);
log(` Pasta Spool:  ${config.spool_dir}`);
log(` Destino API:  ${config.api_url}`);
log(` Intervalo:    ${config.poll_interval_ms}ms`);
log(`=============================================================`);

try {
  const testFiles = fs.readdirSync(config.spool_dir);
  log(`✅ Conexão com Spooler OK! Acesso permitido a: ${config.spool_dir} (${testFiles.length} arquivos no diretório).`);
  log(`🟢 Monitorando impressões no balcão em tempo real...\n`);
} catch (err) {
  log(`❌ ERRO CRÍTICO DE PERMISSÃO NO WINDOWS: ${err.message}`);
  log(`👉 Execute como Administrador!\n`);
}

// Executa primeira varredura imediata
varrerSpool();

// Loop permanente de monitoramento a cada 500ms
setInterval(varrerSpool, config.poll_interval_ms);

process.on('SIGINT', () => {
  log('🛑 Encerrando Agente Spooler Balcão...');
  salvarCache();
  process.exit(0);
});
