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
  TURSO_URL: process.env.TURSO_URL || null,
  TURSO_TOKEN: process.env.TURSO_TOKEN || null,
  TRACCAR_URL: process.env.TRACCAR_URL || 'http://localhost:8082',
  TRACCAR_USER: process.env.TRACCAR_USER || 'admin',
  TRACCAR_PASS: process.env.TRACCAR_PASS || 'admin',
  JWT_SECRET: process.env.JWT_SECRET || 'default_secret_key',
  BALCAO_API_SECRET: process.env.BALCAO_API_SECRET || 'balcao_secret_token_aoponto_2026',
  // Configurações iFood (Homologação)
  IFOOD_CLIENT_ID: process.env.IFOOD_CLIENT_ID || 'c88219c5-8ad0-40d1-8f2f-387d9895ce02',
  IFOOD_CLIENT_SECRET: process.env.IFOOD_CLIENT_SECRET || 'bb0o039xteom0dym0lxp38tos1he9qmnb2qimf81tiotbxuvjg4lf1fxled3hwllvqi1dmx9lc2luhjr4ywkoz7vkkskdfcruun',
  IFOOD_MERCHANT_ID: process.env.IFOOD_MERCHANT_ID || 'ce4602c7-54ae-4594-855c-a170ff081af9',
  IFOOD_API_URL: process.env.IFOOD_API_URL || 'https://merchant-api.ifood.com.br',
  IFOOD_WEBHOOK_SECRET: process.env.IFOOD_WEBHOOK_SECRET || '',
  // Configurações 99Food (Homologação / DiDi Open Platform)
  FOOD99_APP_ID: process.env.FOOD99_APP_ID || '5764607677240445075',
  FOOD99_APP_SECRET: process.env.FOOD99_APP_SECRET || '657b25c639a5ebe15c721eed2ae8a972',
  FOOD99_AUTH_TOKEN: process.env.FOOD99_AUTH_TOKEN || 'ZThlMzAzZDEyY2FkNGUyNTNkOWJkNDAYTNjMGM0OTQ=',
  FOOD99_SHOP_ID: process.env.FOOD99_SHOP_ID || '5764617873609198563',
  FOOD99_APP_SHOP_ID: process.env.FOOD99_APP_SHOP_ID || '03122022',
  FOOD99_API_URL: process.env.FOOD99_API_URL || 'https://openapi.99food.com'
};

