/**
 * Cache em memória ultra-rápido para redução drástica de Row Reads no Turso
 * Armazena temporariamente respostas de consultas frequentes (TTL padrão: 3 segundos)
 * Invalidação atômica e instantânea sempre que houver mutação (novo pedido, retirada, entrega, etc.)
 */
const cache = new Map();

function get(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function set(key, data, ttlMs = 3000) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

function clear() {
  cache.clear();
}

function invalidatePrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

module.exports = {
  get,
  set,
  clear,
  invalidatePrefix
};
