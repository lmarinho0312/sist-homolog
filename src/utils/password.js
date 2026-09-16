const crypto = require('crypto');

/**
 * Criptografa a senha do usuário utilizando scrypt nativo do Node.js
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Compara a senha informada com a senha armazenada no banco
 */
function comparePassword(password, storedPassword) {
  try {
    if (!storedPassword || !storedPassword.includes(':')) {
      return false;
    }
    const [salt, originalHash] = storedPassword.split(':');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch (err) {
    return false;
  }
}

module.exports = { hashPassword, comparePassword };
