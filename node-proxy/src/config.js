'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  valkeyUrl: 'redis://127.0.0.1:6379',
  proxyPort: 8080,
  adminPort: 3001,
  proxyTimeoutMs: 30000,
  allowedClientIps: ['127.0.0.1', '::1'],
  trustProxyHeaders: false,
  sessionHeader: 'X-Session-ID',
  tls: {
    certFile: '',
    keyFile: '',
  },
};

function resolveConfigPath() {
  const argIndex = process.argv.indexOf('--config');
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }

  const candidates = [
    '/config/config.json',
    path.join(process.cwd(), 'config.json'),
    path.join(process.cwd(), 'config', 'node-proxy.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Config file not found. Pass --config /path/to/config.json or mount /config/config.json'
  );
}

function loadConfig(configPath) {
  const filePath = configPath || resolveConfigPath();
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  const allowedClientIps = Array.isArray(parsed.allowedClientIps)
    ? parsed.allowedClientIps
    : DEFAULTS.allowedClientIps;

  return {
    configPath: filePath,
    valkeyUrl: parsed.valkeyUrl || DEFAULTS.valkeyUrl,
    proxyPort: Number(parsed.proxyPort || DEFAULTS.proxyPort),
    adminPort: Number(parsed.adminPort || DEFAULTS.adminPort),
    proxyTimeoutMs: Number(parsed.proxyTimeoutMs || DEFAULTS.proxyTimeoutMs),
    allowedClientIps,
    trustProxyHeaders: Boolean(parsed.trustProxyHeaders),
    sessionHeader: parsed.sessionHeader || DEFAULTS.sessionHeader,
    tls: {
      certFile: parsed.tls?.certFile || '',
      keyFile: parsed.tls?.keyFile || '',
    },
  };
}

module.exports = { loadConfig, resolveConfigPath, DEFAULTS };
