const crypto = require('node:crypto');

const KEY_LEN = 64;

/**
 * Hashes a password with a random salt using scrypt.
 * Returns a single string "salt:hash" (both hex) so it's easy to store
 * in one database column.
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
    return `${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored "salt:hash" string.
 */
function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const candidate = crypto.scryptSync(password, salt, KEY_LEN);
    const expected = Buffer.from(hash, 'hex');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
}

module.exports = { hashPassword, verifyPassword };
