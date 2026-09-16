const { getDb } = require('./db');

async function initDb() {
  try {
    console.log('🔄 Inicializando o banco de dados...');
    const db = getDb();
    
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS motoboys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    telefone TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    traccar_device_id TEXT UNIQUE NOT NULL,
    grupo TEXT NOT NULL DEFAULT 'VELOZ',
    latitude REAL,
    longitude REAL,
    velocidade REAL DEFAULT 0,
    ultima_atualizacao DATETIME,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_pedido TEXT NOT NULL,
    motoboy_id INTEGER,
    status TEXT NOT NULL DEFAULT 'disponivel',
    grupo TEXT NULL,
    origem TEXT DEFAULT 'MANUAL',
    pedido_id_origem TEXT,
    cliente TEXT,
    endereco TEXT,
    bairro TEXT,
    taxa_entrega REAL DEFAULT 0.0,
    telefone_cliente TEXT,
    localizador TEXT,
    texto_bruto TEXT,
    data_inicio DATETIME NULL,
    data_fim DATETIME NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (motoboy_id) REFERENCES motoboys(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pedido_rotas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id INTEGER NOT NULL,
    motoboy_id INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    velocidade REAL DEFAULT 0,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS taxa_bairro (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bairro TEXT NOT NULL UNIQUE COLLATE NOCASE,
    taxa REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS taxa_bairro_speed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bairro TEXT NOT NULL UNIQUE COLLATE NOCASE,
    taxa REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_motoboy_status ON pedidos(motoboy_id, status);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_grupo_status ON pedidos(grupo, status);
CREATE INDEX IF NOT EXISTS idx_pedidos_origem_id ON pedidos(origem, pedido_id_origem);
CREATE INDEX IF NOT EXISTS idx_pedido_rotas_pedido ON pedido_rotas(pedido_id);
`.trim();

async function initDb() {
  try {
    console.log('🔄 Inicializando o banco de dados...');
    const db = getDb();
    await db.exec(SCHEMA_SQL);
    console.log('✅ Tabelas verificadas e criadas!');
  } catch (error) {
    console.error('❌ Erro ao inicializar o banco de dados:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  initDb();
}

module.exports = { initDb, SCHEMA_SQL };

