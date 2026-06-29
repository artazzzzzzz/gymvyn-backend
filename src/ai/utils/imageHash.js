const crypto = require('crypto');

function hashImage(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = { hashImage };
