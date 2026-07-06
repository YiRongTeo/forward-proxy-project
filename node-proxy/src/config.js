'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  valkey: {
    url: 'redis://127.0.0.1:6379',
    sentinel: null,
    tls: {
      enabled: false,
      caFile: '',
      certFile: '',
      keyFile: '',
      serverName: '',
      insecureSkipVerify: false,
    },
  },
  proxyPort: 8080,
  adminPort: 3001,
  proxyTimeoutMs: 30000,
  allowedClientIps: ['127.0.0.1', '::1'],
  trustProxyHeaders: false,
  sessionHeader: 'X-Session-ID',
  requireSessionFromHeader: true,
  acceptSessionFromProxyAuth: false,
  defaultAllowedDomains: [],
  publicDomains: [],
  tls: {
    certFile: '',
    keyFile: '',
  },
};

function parseValkeyTls(parsed) {
  const input = parsed.valkeyTls;
  if (!input) {
    return { ...DEFAULTS.valkey.tls };
  }

  return {
    enabled: Boolean(input.enabled),
    caFile: input.caFile || '',
    certFile: input.certFile || '',
    keyFile: input.keyFile || '',
    serverName: input.serverName || '',
    insecureSkipVerify: Boolean(input.insecureSkipVerify),
  };
}

function parseValkeyConfig(parsed) {
  const sentinelInput = parsed.valkeySentinel;
  let sentinel = null;

  if (sentinelInput && sentinelInput.masterName && Array.isArray(sentinelInput.sentinels)) {
    sentinel = {
      masterName: String(sentinelInput.masterName),
      sentinels: sentinelInput.sentinels.map(String),
      password: sentinelInput.password || '',
      sentinelPassword: sentinelInput.sentinelPassword || '',
      db: sentinelInput.db !== undefined ? Number(sentinelInput.db) : 0,
    };
  }

  return {
    url: parsed.valkeyUrl || DEFAULTS.valkey.url,
    sentinel,
    tls: parseValkeyTls(parsed),
  };
}

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

  const requireSessionFromHeader =
    parsed.requireSessionFromHeader !== undefined
      ? Boolean(parsed.requireSessionFromHeader)
      : DEFAULTS.requireSessionFromHeader;

  const acceptSessionFromProxyAuth =
    parsed.acceptSessionFromProxyAuth !== undefined
      ? Boolean(parsed.acceptSessionFromProxyAuth)
      : DEFAULTS.acceptSessionFromProxyAuth;

  const defaultAllowedDomains = Array.isArray(parsed.defaultAllowedDomains)
    ? parsed.defaultAllowedDomains.map(String)
    : DEFAULTS.defaultAllowedDomains;

  const publicDomains = Array.isArray(parsed.publicDomains)
    ? parsed.publicDomains.map(String)
    : DEFAULTS.publicDomains;

  return {
    configPath: filePath,
    valkey: parseValkeyConfig(parsed),
    proxyPort: Number(parsed.proxyPort || DEFAULTS.proxyPort),
    adminPort: Number(parsed.adminPort || DEFAULTS.adminPort),
    proxyTimeoutMs: Number(parsed.proxyTimeoutMs || DEFAULTS.proxyTimeoutMs),
    allowedClientIps,
    trustProxyHeaders: Boolean(parsed.trustProxyHeaders),
    sessionHeader: parsed.sessionHeader || DEFAULTS.sessionHeader,
    requireSessionFromHeader,
    acceptSessionFromProxyAuth,
    defaultAllowedDomains,
    publicDomains,
    tls: {
      certFile: parsed.tls?.certFile || '',
      keyFile: parsed.tls?.keyFile || '',
    },
  };
}

module.exports = { loadConfig, resolveConfigPath, DEFAULTS, parseValkeyConfig };
