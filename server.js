const fs = require('node:fs');
const path = require('node:path');
const config = require('./src/config/env');
const { getDb } = require('./src/database/db');

const authController = require('./src/controllers/authController');
const pedidosController = require('./src/controllers/pedidosController');
const adminController = require('./src/controllers/adminController');

// ── Roteador ──────────────────────────────────────────────────────────────────
const routes = { GET: {}, POST: {}, PUT: {}, DELETE: {} };

function registerRoute(method, urlPath, handlerFn) {
  routes[method][urlPath] = handlerFn;
}

// ── Registro de Rotas ─────────────────────────────────────────────────────────

// Health Check
registerRoute('GET', '/api/health', async (req, res) => {
  try {
    const db = getDb();
    const [motoboysRes, pedidosRes] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as count FROM motoboys'),
      db.queryOne('SELECT COUNT(*) as count FROM pedidos')
    ]);
    return res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        provider: config.TURSO_URL ? 'turso' : 'sqlite_local',
        motoboys_cadastrados: motoboysRes ? Number(motoboysRes.count) : 0,
        pedidos_cadastrados: pedidosRes ? Number(pedidosRes.count) : 0
      },
      traccar_url: config.TRACCAR_URL
    });
  } catch (error) {
    return res.json(500, { status: 'error', message: error.message });
  }
});

// Autenticação
registerRoute('POST', '/api/auth/login', authController.login);
registerRoute('POST', '/api/auth/register', authController.register);
registerRoute('POST', '/api/auth/admin-login', authController.loginAdmin);
registerRoute('POST', '/api/auth/admin-alterar-senha', authController.alterarSenhaAdmin);

// Pedidos
registerRoute('POST', '/api/pedidos/iniciar', pedidosController.iniciarPedido);
registerRoute('POST', '/api/pedidos/finalizar', pedidosController.finalizarPedido);
registerRoute('GET', '/api/pedidos/motoboy', pedidosController.listarPedidosMotoboy);
registerRoute('POST', '/api/pedidos/webhook-spool', pedidosController.webhookSpool);
registerRoute('GET', '/api/pedidos/disponiveis', pedidosController.listarPedidosDisponiveis);
registerRoute('POST', '/api/pedidos/retirar', pedidosController.assumirPedido);
registerRoute('GET', '/api/pedidos/detalhes', pedidosController.obterDetalhesPedido);
registerRoute('POST', '/api/pedidos/status', pedidosController.atualizarStatusPedido);
registerRoute('POST', '/api/pedidos/definir-grupo', pedidosController.definirGrupoPedido);

const posicaoController = require('./src/controllers/posicaoController');

// Posição GPS em Tempo Real
registerRoute('POST', '/api/motoboy/posicao', posicaoController.atualizarPosicaoMotoboy);
registerRoute('GET', '/api/traccar/location', posicaoController.webhookTraccarClient);
registerRoute('POST', '/api/traccar/location', posicaoController.webhookTraccarClient);

// Admin / Dashboard, Mapa e Histórico
const historicoController = require('./src/controllers/historicoController');
registerRoute('GET', '/api/admin/stats', adminController.getDashboardStats);
registerRoute('GET', '/api/admin/pedidos', adminController.listarTodosPedidos);
registerRoute('GET', '/api/admin/motoboys', adminController.listarMotoboysAdmin);
registerRoute('GET', '/api/admin/posicoes-mapa', adminController.getPosicoesMapa);
registerRoute('GET', '/api/admin/historico', historicoController.listarHistoricoEntregas);
registerRoute('GET', '/api/admin/historico/rota', historicoController.obterRotaPedido);
registerRoute('GET', '/api/admin/fechamento', adminController.obterFechamentoEntregas);
registerRoute('POST', '/api/admin/pedidos/manual', adminController.criarPedidoManual);
registerRoute('POST', '/api/admin/pedidos/limpar-pendentes-antigos', adminController.limparPedidosPendentesAntigos);
registerRoute('POST', '/api/admin/pedidos/atribuir', adminController.atribuirPedidoMotoboy);
registerRoute('POST', '/api/admin/pedidos/descartar', adminController.descartarPedido);
registerRoute('DELETE', '/api/pedidos/descartar', adminController.descartarPedido);

// Gestão de Entregadores & Taxas por Bairro (Protegido por Senha)
registerRoute('POST', '/api/admin/motoboys/verificar-senha', adminController.verificarSenhaMotoboys);
registerRoute('POST', '/api/admin/motoboys/atualizar', adminController.atualizarMotoboy);
registerRoute('POST', '/api/admin/motoboys/cadastrar', adminController.cadastrarMotoboyAdmin);
registerRoute('GET', '/api/admin/taxas', adminController.obterTaxasBairros);
registerRoute('POST', '/api/admin/taxas/atualizar', adminController.atualizarTaxaBairro);

// Rendimentos Motoboy
registerRoute('GET', '/api/motoboy/rendimentos', pedidosController.obterRendimentosMotoboy);

// ── Homologação Oficial iFood API ─────────────────────────────────────────────
const ifoodController = require('./src/controllers/ifoodController');
registerRoute('GET', '/api/ifood/status', ifoodController.checkStatus);
registerRoute('POST', '/api/ifood/webhook', ifoodController.handleWebhook);
registerRoute('GET', '/api/ifood/events', ifoodController.listRecentEvents);
registerRoute('POST', '/api/ifood/orders/confirm', ifoodController.confirmOrderAction);
registerRoute('POST', '/api/ifood/orders/dispatch', ifoodController.dispatchOrderAction);
registerRoute('POST', '/api/ifood/orders/cancel', ifoodController.cancelOrderAction);
registerRoute('GET', '/api/ifood/orders/reasons', ifoodController.getCancellationReasonsAction);
registerRoute('POST', '/api/ifood/simulate', ifoodController.simulateEvent);
registerRoute('GET', '/api/ifood/ping', ifoodController.pingPresenceAction);
registerRoute('POST', '/api/ifood/ping', ifoodController.pingPresenceAction);
registerRoute('GET', '/api/ifood/config', ifoodController.getConfig);
registerRoute('POST', '/api/ifood/config', ifoodController.setConfig);

// ── Homologação Oficial 99Food / DiDi Open Platform ───────────────────────────
const ninetyNineFoodController = require('./src/controllers/ninetyNineFoodController');
registerRoute('GET', '/api/99food/status', ninetyNineFoodController.checkStatus);
registerRoute('GET', '/api/99food/webhook', ninetyNineFoodController.handleWebhook);
registerRoute('POST', '/api/99food/webhook', ninetyNineFoodController.handleWebhook);
registerRoute('GET', '/api/99food/events', ninetyNineFoodController.listRecentEvents);
registerRoute('POST', '/api/99food/orders/confirm', ninetyNineFoodController.confirmOrderAction);
registerRoute('POST', '/api/99food/orders/ready', ninetyNineFoodController.readyOrderAction);
registerRoute('POST', '/api/99food/orders/dispatch', ninetyNineFoodController.dispatchOrderAction);
registerRoute('POST', '/api/99food/orders/cancel', ninetyNineFoodController.cancelOrderAction);
registerRoute('GET', '/api/99food/orders/details', ninetyNineFoodController.getOrderDetailsAction);
registerRoute('GET', '/api/99food/stores/auth-url', ninetyNineFoodController.getAuthorizationUrlAction);

// ── Handler principal (usado pela Vercel e pelo servidor local) ────────────────
async function requestHandler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Helper res.json (compatível com Node http nativo e Vercel Serverless)
  res.json = (statusCodeOrData, data) => {
    let status = 200;
    let payload = statusCodeOrData;
    if (typeof statusCodeOrData === 'number') {
      status = statusCodeOrData;
      payload = data;
    }
    if (!res.headersSent) {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // Anti-cache total para garantir que requisições automáticas do front-end sempre tragam dados frescos
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
    }
    res.end(JSON.stringify(payload));
  };

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  req.query = Object.fromEntries(parsedUrl.searchParams);

  // Parsear body se não existir ou se não tiver sido parseado pela Vercel
  if (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0)) {
    await new Promise((resolve) => {
      let bodyData = '';
      req.on('data', chunk => { bodyData += chunk; });
      req.on('end', () => {
        try { 
          if (bodyData) {
            req.rawBody = bodyData;
            const safeData = bodyData.replace(/"(order_id|app_id|shop_id|event_id)":\s*(\d{15,})/g, '"$1":"$2"');
            req.body = JSON.parse(safeData); 
          }
        } catch (e) {
          try { req.body = JSON.parse(bodyData); } catch (err) {}
        }
        resolve();
      });
      if (req.readableEnded || req.complete) {
        resolve();
      }
    });
  }

  // Roteamento
  const routeHandler = routes[req.method] && routes[req.method][pathname];
  if (routeHandler) {
    try {
      return await routeHandler(req, res);
    } catch (err) {
      console.error('❌ Erro no handler:', err);
      return res.json(500, { error: 'Erro interno', message: err.message });
    }
  }

  // Arquivos estáticos
  const publicDir = path.join(__dirname, 'public');
  let targetFile = pathname === '/' ? 'admin.html' : pathname;
  let filePath = path.join(publicDir, targetFile);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    if (!res.headersSent) res.writeHead(200, { 'Content-Type': contentType });
    return fs.createReadStream(filePath).pipe(res);
  }

  return res.json(404, { error: 'Rota não encontrada', path: pathname });
}

// ── Servidor HTTP local ───────────────────────────────────────────────────────
if (require.main === module) {
  const http = require('node:http');
  const server = http.createServer(requestHandler);
  server.listen(config.PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Servidor do Sistema de Rastreamento Iniciado!`);
    console.log(`📍 Painel Cozinha: http://localhost:${config.PORT}/admin.html`);
    console.log(`📱 App Motoboy:    http://localhost:${config.PORT}/motoboy.html`);
    console.log(`🗺️  API Mapa:       http://localhost:${config.PORT}/api/admin/posicoes-mapa`);
    console.log(`🔍 Health Check:   http://localhost:${config.PORT}/api/health`);
    console.log(`==================================================`);
  });
}

// ── Export para Vercel (serverless) ──────────────────────────────────────────
module.exports = requestHandler;
