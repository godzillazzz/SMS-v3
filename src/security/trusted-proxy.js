const net = require('node:net');

function isLoopbackAddress(address) {
  const normalized = String(address || '').replace(/^::ffff:/i, '');
  return net.isIP(normalized) > 0 && (normalized === '127.0.0.1' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1');
}

function trustProxyAddress(address, index = 0, enabled = false) {
  return Boolean(enabled) && index === 0 && isLoopbackAddress(address);
}

module.exports = { isLoopbackAddress, trustProxyAddress };
