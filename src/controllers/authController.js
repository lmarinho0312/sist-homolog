const { getDb } = require('../database/db');
const { comparePassword, hashPassword } = require('../utils/password');

/**
 * Login de Motoboys (App Mobile)
 */
async function login(req, res) {
  try {
    const { telefone, senha } = req.body || {};

    if (!telefone || !senha) {
      return res.json(400, { success: false, message: 'Por favor, informe o telefone e a senha.' });
    }

    const cleanTelefone = String(telefone).trim().replace(/\D/g, '');
    const db = getDb();

    const motoboy = await db.queryOne(
      `SELECT id, nome, telefone, senha, traccar_device_id, grupo FROM motoboys WHERE telefone = ? OR telefone = ?`,
      [cleanTelefone, String(telefone).trim()]
    );

    if (!motoboy) {
      return res.json(401, { success: false, message: 'Motoboy não encontrado com este telefone.' });
    }

    const isValidPassword = comparePassword(senha, motoboy.senha);
    if (!isValidPassword) {
      return res.json(401, { success: false, message: 'Senha incorreta. Tente novamente.' });
    }

    return res.json(200, {
      success: true,
      message: 'Login realizado com sucesso!',
      motoboy: {
        id: motoboy.id,
        nome: motoboy.nome,
        telefone: motoboy.telefone,
        traccar_device_id: motoboy.traccar_device_id,
        grupo: motoboy.grupo || 'VELOZ'
      }
    });
  } catch (error) {
    console.error('❌ Erro no login:', error);
    return res.json(500, { success: false, message: 'Erro interno ao realizar login.', error: error.message });
  }
}

/**
 * Cadastro de Motoboys
 */
async function register(req, res) {
  try {
    const { nome, telefone, senha, traccar_device_id, grupo } = req.body || {};

    if (!nome || !telefone || !senha) {
      return res.json(400, { success: false, message: 'Nome, telefone e senha são obrigatórios.' });
    }

    const cleanTelefone = String(telefone).trim().replace(/\D/g, '');
    const deviceId = traccar_device_id ? String(traccar_device_id).trim() : cleanTelefone;
    let cleanGrupo = grupo ? String(grupo).trim().toUpperCase() : 'VELOZ';
    if (cleanGrupo !== 'VELOZ' && cleanGrupo !== 'SPEED') cleanGrupo = 'VELOZ';

    const db = getDb();

    const existente = await db.queryOne(
      `SELECT id FROM motoboys WHERE telefone = ? OR traccar_device_id = ?`,
      [cleanTelefone, deviceId]
    );

    if (existente) {
      return res.json(400, { success: false, message: 'Já existe um motoboy cadastrado com este telefone ou ID do Traccar.' });
    }

    const hashedPassword = hashPassword(senha);

    const result = await db.execute(
      `INSERT INTO motoboys (nome, telefone, senha, traccar_device_id, grupo) VALUES (?, ?, ?, ?, ?)`,
      [String(nome).trim(), cleanTelefone, hashedPassword, deviceId, cleanGrupo]
    );

    return res.json(201, {
      success: true,
      message: 'Motoboy cadastrado com sucesso!',
      motoboy: {
        id: Number(result.lastInsertRowid),
        nome: String(nome).trim(),
        telefone: cleanTelefone,
        traccar_device_id: deviceId,
        grupo: cleanGrupo
      }
    });
  } catch (error) {
    console.error('❌ Erro no cadastro:', error);
    return res.json(500, { success: false, message: 'Erro interno ao cadastrar motoboy.', error: error.message });
  }
}

/**
 * Login de Administrador / Cozinha (Painel Web)
 */
async function loginAdmin(req, res) {
  try {
    const { usuario, senha } = req.body || {};

    if (!usuario || !senha) {
      return res.json(400, { success: false, message: 'Usuário e senha são obrigatórios.' });
    }

    const cleanUsuario = String(usuario).trim().toLowerCase();
    const db = getDb();

    const admin = await db.queryOne(
      `SELECT id, usuario, nome, senha, cargo FROM usuarios_admin WHERE LOWER(usuario) = ?`,
      [cleanUsuario]
    );

    if (!admin) {
      return res.json(401, { success: false, message: 'Usuário não encontrado.' });
    }

    const isValidPassword = comparePassword(senha, admin.senha);
    if (!isValidPassword) {
      return res.json(401, { success: false, message: 'Senha incorreta. Tente novamente.' });
    }

    return res.json(200, {
      success: true,
      message: 'Acesso autorizado ao painel da cozinha!',
      admin: {
        id: admin.id,
        usuario: admin.usuario,
        nome: admin.nome,
        cargo: admin.cargo || 'cozinha'
      }
    });
  } catch (error) {
    console.error('❌ Erro no login de admin:', error);
    return res.json(500, { success: false, message: 'Erro interno no login de administrador.', error: error.message });
  }
}

/**
 * Alteração de Senha do Administrador
 */
async function alterarSenhaAdmin(req, res) {
  try {
    const { usuario, senha_atual, nova_senha } = req.body || {};

    if (!usuario || !senha_atual || !nova_senha) {
      return res.json(400, { success: false, message: 'Todos os campos são obrigatórios.' });
    }

    if (String(nova_senha).length < 4) {
      return res.json(400, { success: false, message: 'A nova senha deve ter no mínimo 4 caracteres.' });
    }

    const cleanUsuario = String(usuario).trim().toLowerCase();
    const db = getDb();

    const admin = await db.queryOne(
      `SELECT id, usuario, senha FROM usuarios_admin WHERE LOWER(usuario) = ?`,
      [cleanUsuario]
    );

    if (!admin) {
      return res.json(404, { success: false, message: 'Usuário não encontrado.' });
    }

    const isValidPassword = comparePassword(senha_atual, admin.senha);
    if (!isValidPassword) {
      return res.json(401, { success: false, message: 'Senha atual incorreta.' });
    }

    const hashedNovaSenha = hashPassword(nova_senha);
    await db.execute(
      `UPDATE usuarios_admin SET senha = ? WHERE id = ?`,
      [hashedNovaSenha, admin.id]
    );

    return res.json(200, {
      success: true,
      message: 'Senha alterada com sucesso!'
    });
  } catch (error) {
    console.error('❌ Erro ao alterar senha de admin:', error);
    return res.json(500, { success: false, message: 'Erro interno ao alterar senha.', error: error.message });
  }
}

module.exports = { login, register, loginAdmin, alterarSenhaAdmin };
