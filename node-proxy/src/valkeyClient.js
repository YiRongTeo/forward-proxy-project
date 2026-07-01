'use strict';

const IoValkey = require('iovalkey');
const { loadTlsOptions, tlsUrlScheme } = require('./valkeyTls');

const CLIENT_OPTS = {
  enableReadyCheck: false,
  maxRetriesPerRequest: 3,
  lazyConnect: false,
};

function parseSentinelAddrs(entries) {
  return entries.map((entry) => {
    const trimmed = String(entry).trim();
    const lastColon = trimmed.lastIndexOf(':');
    if (lastColon === -1) {
      return { host: trimmed, port: 26379 };
    }
    return {
      host: trimmed.slice(0, lastColon),
      port: parseInt(trimmed.slice(lastColon + 1), 10) || 26379,
    };
  });
}

function useSentinel(valkeyConfig) {
  const sentinel = valkeyConfig?.sentinel;
  return Boolean(
    sentinel?.masterName &&
      Array.isArray(sentinel.sentinels) &&
      sentinel.sentinels.length > 0
  );
}

function applyTlsOptions(options, tlsOptions) {
  if (!tlsOptions) return options;
  return {
    ...options,
    tls: tlsOptions,
    sentinelTLS: tlsOptions,
    enableTLSForSentinelMode: true,
  };
}

function createValkeyClient(valkeyConfig) {
  const tlsOptions = loadTlsOptions(valkeyConfig?.tls);

  if (useSentinel(valkeyConfig)) {
    const { masterName, sentinels, password, sentinelPassword, db } = valkeyConfig.sentinel;
    let options = {
      ...CLIENT_OPTS,
      sentinels: parseSentinelAddrs(sentinels),
      name: masterName,
    };
    if (password) options.password = password;
    if (sentinelPassword) options.sentinelPassword = sentinelPassword;
    if (db !== undefined && db !== null) options.db = Number(db);
    options = applyTlsOptions(options, tlsOptions);
    return new IoValkey(options);
  }

  let url = valkeyConfig?.url || 'redis://127.0.0.1:6379';
  if (tlsOptions) {
    url = tlsUrlScheme(url);
  }

  const options = tlsOptions ? { ...CLIENT_OPTS, tls: tlsOptions } : CLIENT_OPTS;
  return new IoValkey(url, options);
}

module.exports = { createValkeyClient, useSentinel, parseSentinelAddrs };
