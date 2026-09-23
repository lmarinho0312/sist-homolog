const fs = require('fs');
const path = require('path');
const config = require('../config/env');

let dbInstance = null;

/**
 * Retorna a instância do banco de dados.
 * - Em produção (Vercel): usa o Turso (libSQL) via TURSO_URL + TURSO_TOKEN
 * - Em desenvolvimento local: usa node:sqlite nativo
 */
function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  // MODO PRODUÇÃO: Turso (libSQL compatível com SQLite)
  if (config.TURSO_URL && config.TURSO_TOKEN) {
    const { createClient } = require('@libsql/client');
    const client = createClient({
      url: config.TURSO_URL,
      authToken: config.TURSO_TOKEN
    });

    // Função de resiliência com retry exponencial contra oscilações de rede com o Turso
    async function executeWithRetry(fn, maxRetries = 3, initialDelayMs = 250) {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (err) {
          attempt++;
          if (attempt >= maxRetries) {
            console.error(`❌ Falha definitiva na operação com Turso após ${attempt} tentativas:`, err.message);
            throw err;
          }
          const delay = initialDelayMs * Math.pow(2, attempt - 1);
          console.warn(`⚠️ Oscilação na conexão com Turso (tentativa ${attempt}/${maxRetries}): ${err.message}. Retentando em ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // Wrapper que emula a API síncrona do node:sqlite mas usa o Turso async com retry automático
    dbInstance = {
      _client: client,
      _isTurso: true,
      prepare: (sql) => ({
        get: (...args) => {
          throw new Error('Turso é assíncrono. Use await db.query() diretamente nos controllers.');
        },
        all: (...args) => {
          throw new Error('Turso é assíncrono. Use await db.query() diretamente nos controllers.');
        },
        run: (...args) => {
          throw new Error('Turso é assíncrono. Use await db.execute() diretamente nos controllers.');
        }
      }),
      // API assíncrona real resiliente para uso nos controllers
      query: async (sql, args = []) => {
        return executeWithRetry(async () => {
          const result = await client.execute({ sql, args });
          return result.rows;
        });
      },
      queryOne: async (sql, args = []) => {
        return executeWithRetry(async () => {
          const result = await client.execute({ sql, args });
          return result.rows[0] || null;
        });
      },
      execute: async (sql, args = []) => {
        return executeWithRetry(async () => {
          const result = await client.execute({ sql, args });
          return {
            changes: result.rowsAffected,
            lastInsertRowid: result.lastInsertRowid
          };
        });
      },
      exec: async (sql) => {
        return executeWithRetry(async () => {
          await client.executeMultiple(sql);
        });
      }
    };

    console.log('✅ Banco de dados Turso (nuvem) conectado com resiliência ativa.');
    return dbInstance;
  }

  // MODO LOCAL: node:sqlite nativo do Node.js v22+
  const { DatabaseSync } = require('node:sqlite');
  let dbPath = path.resolve(__dirname, '../../', config.DB_PATH);

  // Na Vercel (serverless) sem Turso, o sistema de arquivos raiz é estritamente Read-Only.
  // Usamos o diretório /tmp onde temos permissão de escrita para o SQLite.
  if (process.env.VERCEL && !config.TURSO_URL) {
    dbPath = path.join('/tmp', 'homologacao.sqlite');
  }

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const localDb = new DatabaseSync(dbPath);
  localDb.exec('PRAGMA foreign_keys = ON;');

  // Garante que todas as tabelas existam automaticamente
  try {
    localDb.exec(`
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
    status TEXT NOT NULL DEFAULT 'aprovado',
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

CREATE TABLE IF NOT EXISTS ifood_events (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    order_id TEXT,
    merchant_id TEXT,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pedidos_motoboy_status ON pedidos(motoboy_id, status);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_origem_id ON pedidos(origem, pedido_id_origem);
CREATE INDEX IF NOT EXISTS idx_ifood_events_order_id ON ifood_events(order_id);
    `);
  } catch (err) {
    console.warn('⚠️ Inicialização de schema local:', err.message);
  }

  // Adaptar a API local para ter os mesmos métodos assíncronos
  dbInstance = {
    _isTurso: false,
    prepare: (sql) => localDb.prepare(sql),
    query: async (sql, args = []) => {
      return localDb.prepare(sql).all(...args);
    },
    queryOne: async (sql, args = []) => {
      return localDb.prepare(sql).get(...args) || null;
    },
    execute: async (sql, args = []) => {
      const result = localDb.prepare(sql).run(...args);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid
      };
    },
    exec: async (sql) => {
      localDb.exec(sql);
    }
  };

  console.log('✅ Banco de dados SQLite local conectado.');
  return dbInstance;
}

module.exports = { getDb };
