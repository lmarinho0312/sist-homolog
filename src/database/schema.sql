-- Schema do Banco de Dados SQLite / Turso (Sistema de Rastreamento de Entregas)

CREATE TABLE IF NOT EXISTS motoboys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    telefone TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    traccar_device_id TEXT UNIQUE NOT NULL,
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

-- Tabela para armazenar o histórico de pontos GPS de cada rota de entrega
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

CREATE INDEX IF NOT EXISTS idx_pedidos_motoboy_status ON pedidos(motoboy_id, status);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_origem_id ON pedidos(origem, pedido_id_origem);
CREATE INDEX IF NOT EXISTS idx_pedido_rotas_pedido ON pedido_rotas(pedido_id);
