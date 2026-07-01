'use strict';

const IoValkey = require('iovalkey');

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

function createValkeyClient(valkeyConfig) {
  if (useSentinel(valkeyConfig)) {
    const { masterName, sentinels, password, sentinelPassword, db } = valkeyConfig.sentinel;
    const options = {
      ...CLIENT_OPTS,
      sentinels: parseSentinelAddrs(sentinels),
      name: masterName,
    };
    if (password) options.password = password;
    if (sentinelPassword) options.sentinelPassword = sentinelPassword;
    if (db !== undefined && db !== null) options.db = Number(db);
    return new IoValkey(options);
  }

  const url = valkeyConfig?.url || 'redis://127.0.0.1:6379';
  return new IoValkey(url, CLIENT_OPTS);
}

module.exports = { createValkeyClient, useSentinel, parseSentinelAddrs };
