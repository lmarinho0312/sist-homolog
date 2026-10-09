const fs = require('fs');
const path = require('path');

// Carregador nativo de arquivo .env sem dependências externas
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...values] = trimmed.split('=');
      const val = values.join('=').trim().replace(/^["']|["']$/g, '');
      const keyName = key.trim();
      if (keyName && !process.env[keyName]) {
        process.env[keyName] = val;
      }
    }
  });
}

module.exports = {
  PORT: process.env.PORT || 3000,
  DB_PATH: process.env.DB_PATH || './data/database.sqlite',
  TURSO_URL: process.env.TURSO_URL || 'libsql://sistrastreamento-aoponto.aws-us-east-1.turso.io',
  TURSO_TOKEN: process.env.TURSO_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODY0NjkzMzQsImlkIjoiMDE5ZmYxZGUtYjAwMS03MTY1LTgzNWItNjRhNTFhYTk4MzBiIiwia2lkIjoiMkZ2b04zYWpWalhPT0JaMzh5MWZ5UkJCYVlNSjl4cEpPWFZ6ek1rcTdqMCIsInJpZCI6IjVhOTcwYWRkLWU1OGUtNDU4Ni05ZTc4LThlYTA1YzIzM2FlNiJ9.cU2BmtXKFYar-z3FjUqAyLIKmryLMaRJExH-O2zpN0MYXXTEW0KgTlQN-0D4_DLATPk272l0Ehc_aM7-BdoDBQ',
  TRACCAR_URL: process.env.TRACCAR_URL || 'http://localhost:8082',
  TRACCAR_USER: process.env.TRACCAR_USER || 'admin',
  TRACCAR_PASS: process.env.TRACCAR_PASS || 'admin',
  JWT_SECRET: process.env.JWT_SECRET || 'default_secret_key',
  BALCAO_API_SECRET: process.env.BALCAO_API_SECRET || 'balcao_secret_token_aoponto_2026',
  // Configurações iFood (Oficial / rastv2)
  IFOOD_CLIENT_ID: process.env.IFOOD_CLIENT_ID || 'b7b5dda0-bbc4-40d2-b5c8-ebd904c88611',
  IFOOD_CLIENT_SECRET: process.env.IFOOD_CLIENT_SECRET || 'h8dgsnwab9i88ucvvzpjhxmxjnkatocbv9mm9ou8wi07dups8b3pk8rjcjh67u2mcdt3v4zn91ydrq0qghxb5y2ulu30bftar7f',
  IFOOD_MERCHANT_ID: process.env.IFOOD_MERCHANT_ID || '851c6395-504f-44d9-b017-6c10cdfd3de1',
  IFOOD_API_URL: process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br',
  IFOOD_WEBHOOK_SECRET: process.env.IFOOD_WEBHOOK_SECRET || '',
  // Configurações 99Food (Produção / DiDi Open Platform)
  FOOD99_APP_ID: process.env.FOOD99_APP_ID || '5764607534449559450',
  FOOD99_APP_SECRET: process.env.FOOD99_APP_SECRET || '1056bb0b68de904114a8251209b8a70a',
  FOOD99_AUTH_TOKEN: process.env.FOOD99_AUTH_TOKEN || '',
  FOOD99_SHOP_ID: process.env.FOOD99_SHOP_ID || '',
  FOOD99_APP_SHOP_ID: process.env.FOOD99_APP_SHOP_ID || '',
  FOOD99_API_URL: process.env.FOOD99_API_URL || 'https://openapi.99food.com'
};

