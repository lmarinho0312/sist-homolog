const TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJwYU1ldnBXcEVmR0JKaDZlcmt2NldRIiwib3JnX2lkIjoxMDAwMjE5NjExfQ.CdL3bq6tzs-_Je8EyDrPRs5fEzpMoh5mG1K0WZmEH9GchtbMwU0j0muwHZpkYYjgvCMjKeHEBSvKxYhFeNKZCw';
const HEADERS = { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
const BASE = 'https://api.turso.tech';
const ORG = 'aoponto';
const DB_NAME = 'sistrastreamento';

async function api(method, path, body) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; }
}

async function main() {
  // 1. Criar grupo "default" em São Paulo (gru = mais próximo do Brasil)
  console.log('🔄 Criando grupo "default" em São Paulo (gru)...');
  const grpRes = await api('POST', `/v1/organizations/${ORG}/groups`, {
    name: 'default',
    location: 'aws-us-east-1'
  });
  if (grpRes.status === 200 || grpRes.status === 201 || grpRes.status === 409) {
    console.log('✅ Grupo criado (ou já existia)!');
  } else {
    console.error('❌ Falha no grupo:', JSON.stringify(grpRes.data));
    console.log('🔄 Tentando com "aws-us-east-2"...');
    const grp2 = await api('POST', `/v1/organizations/${ORG}/groups`, {
      name: 'default',
      location: 'aws-us-east-2'
    });
    if (grp2.status === 200 || grp2.status === 201) {
      console.log('✅ Grupo criado em iad!');
    } else {
      console.error('❌ Falha total:', JSON.stringify(grp2.data));
      process.exit(1);
    }
  }

  // Aguardar o grupo ficar pronto
  await new Promise(r => setTimeout(r, 3000));

  // 2. Criar banco de dados no grupo
  console.log(`🔄 Criando banco "${DB_NAME}"...`);
  const dbRes = await api('POST', `/v1/organizations/${ORG}/databases`, {
    name: DB_NAME,
    group: 'default'
  });
  if (dbRes.status === 200 || dbRes.status === 201 || dbRes.status === 409) {
    console.log('✅ Banco criado (ou já existia)!');
  } else {
    console.error('❌ Falha no banco:', JSON.stringify(dbRes.data));
    process.exit(1);
  }

  // 3. Obter hostname do banco
  await new Promise(r => setTimeout(r, 2000));
  const dbInfo = await api('GET', `/v1/organizations/${ORG}/databases/${DB_NAME}`);
  const hostname = dbInfo.data.hostname || dbInfo.data.database?.hostname;
  if (!hostname) {
    console.error('❌ Não consegui obter o hostname:', JSON.stringify(dbInfo.data, null, 2));
    process.exit(1);
  }
  const tursoUrl = `libsql://${hostname}`;
  console.log(`✅ URL: ${tursoUrl}`);

  // 4. Criar token de acesso
  console.log('🔄 Gerando token do banco...');
  const tokenRes = await api('POST', `/v1/organizations/${ORG}/databases/${DB_NAME}/auth/tokens?expiration=never`);
  if (tokenRes.status !== 200) {
    console.error('❌ Falha no token:', JSON.stringify(tokenRes.data));
    process.exit(1);
  }
  const dbToken = tokenRes.data.jwt;
  console.log('✅ Token gerado!');

  // 5. Criar tabelas remotamente
  console.log('🔄 Criando tabelas no banco remoto...');
  const { createClient } = require('@libsql/client');
  const client = createClient({ url: tursoUrl, authToken: dbToken });
  await client.executeMultiple(`
CREATE TABLE IF NOT EXISTS motoboys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    telefone TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    traccar_device_id TEXT UNIQUE NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pedidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_pedido TEXT NOT NULL,
    motoboy_id INTEGER,
    status TEXT NOT NULL DEFAULT 'em_rota',
    data_inicio DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_fim DATETIME NULL,
    FOREIGN KEY (motoboy_id) REFERENCES motoboys(id) ON DELETE SET NULL
);
  `);
  await client.close();
  console.log('✅ Tabelas criadas!');

  // 6. Salvar resultado
  const fs = require('fs');
  const creds = { tursoUrl, dbToken, orgName: ORG };
  fs.writeFileSync('.turso_credentials.json', JSON.stringify(creds, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('🎉 TURSO CONFIGURADO COM SUCESSO!');
  console.log('='.repeat(60));
  console.log('\nTURSO_URL=' + tursoUrl);
  console.log('TURSO_TOKEN=' + dbToken);
  console.log('\n💾 Credenciais salvas em .turso_credentials.json');
}

main().catch(e => { console.error('❌ ERRO:', e.message); process.exit(1); });
