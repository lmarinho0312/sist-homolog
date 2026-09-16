const { hashPassword } = require('../utils/password');
const { getDb } = require('./db');
const { initDb } = require('./initDb');

async function seed() {
  try {
    await initDb();
    const db = getDb();
    console.log('🌱 Povoando banco de dados com dados de teste...');

    await db.execute('DELETE FROM pedidos');
    await db.execute('DELETE FROM motoboys');

    const hashedPassword = hashPassword('123456');

    const r1 = await db.execute(
      `INSERT INTO motoboys (nome, telefone, senha, traccar_device_id) VALUES (?, ?, ?, ?)`,
      ['João Silva', '11999998888', hashedPassword, '11999998888']
    );
    const motoboy1Id = Number(r1.lastInsertRowid);

    const r2 = await db.execute(
      `INSERT INTO motoboys (nome, telefone, senha, traccar_device_id) VALUES (?, ?, ?, ?)`,
      ['Maria Oliveira', '11988887777', hashedPassword, '11988887777']
    );
    const motoboy2Id = Number(r2.lastInsertRowid);

    console.log(`✅ Motoboys cadastrados: João (ID: ${motoboy1Id}), Maria (ID: ${motoboy2Id})`);

    await db.execute(
      `INSERT INTO pedidos (numero_pedido, motoboy_id, status, data_inicio) VALUES (?, ?, 'em_rota', CURRENT_TIMESTAMP)`,
      ['1042', motoboy1Id]
    );
    await db.execute(
      `INSERT INTO pedidos (numero_pedido, motoboy_id, status, data_inicio) VALUES (?, ?, 'em_rota', CURRENT_TIMESTAMP)`,
      ['1043', motoboy1Id]
    );
    await db.execute(
      `INSERT INTO pedidos (numero_pedido, motoboy_id, status, data_inicio) VALUES (?, ?, 'em_rota', CURRENT_TIMESTAMP)`,
      ['1044', motoboy2Id]
    );
    await db.execute(
      `INSERT INTO pedidos (numero_pedido, motoboy_id, status, data_inicio, data_fim) VALUES (?, ?, 'entregue', DATETIME('now', '-30 minutes'), CURRENT_TIMESTAMP)`,
      ['1040', motoboy1Id]
    );

    console.log('✅ Pedidos de teste inseridos (1042, 1043, 1044 em rota, 1040 entregue)!');
    console.log('🎉 Seed finalizado com sucesso.');
  } catch (error) {
    console.error('❌ Erro durante o seed do banco de dados:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
