importScripts('rules.js');

const DEFAULT_PROXY = { host: 'localhost', port: 8080, scheme: 'http' };

const cachedConfig = {
  userSessionId: '',
  password: '',
  proxyHost: DEFAULT_PROXY.host,
  proxyPort: DEFAULT_PROXY.port,
  proxyScheme: DEFAULT_PROXY.scheme,
};

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        userSessionId: '',
        password: '',
        proxyHost: DEFAULT_PROXY.host,
        proxyPort: DEFAULT_PROXY.port,
        proxyScheme: DEFAULT_PROXY.scheme,
      },
      (cfg) => {
        syncCachedConfig(cfg);
        resolve(cfg);
      }
    );
  });
}

function syncCachedConfig(cfg) {
  try {
    const parsed = parseProxySettings(cfg.proxyHost, cfg.proxyPort, cfg.proxyScheme);
    cachedConfig.userSessionId = cfg.userSessionId || '';
    cachedConfig.password = cfg.password || '';
    cachedConfig.proxyHost = parsed.proxyHost;
    cachedConfig.proxyPort = parsed.proxyPort;
    cachedConfig.proxyScheme = parsed.proxyScheme;
  } catch (_err) {
    cachedConfig.userSessionId = cfg.userSessionId || '';
    cachedConfig.password = cfg.password || '';
    cachedConfig.proxyHost = DEFAULT_PROXY.host;
    cachedConfig.proxyPort = DEFAULT_PROXY.port;
    cachedConfig.proxyScheme = DEFAULT_PROXY.scheme;
  }
}

function normalizeHost(host) {
  if (!host) return '';
  const value = host.toLowerCase();
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1') {
    return 'loopback';
  }
  return value;
}

function isOurProxyChallenge(details) {
  if (details.isProxy) return true;

  const challenger = details.challenger || {};
  const challengerPort = parseInt(challenger.port, 10);
  const expectedPort = cachedConfig.proxyPort || DEFAULT_PROXY.port;
  if (challengerPort !== expectedPort) return false;

  return normalizeHost(challenger.host) === normalizeHost(cachedConfig.proxyHost);
}

function proxyAuthCredentials(userSessionId, password) {
  return {
    authCredentials: {
      username: userSessionId,
      password,
    },
  };
}

function handleProxyAuth(details, callback) {
  (async () => {
    if (!details.isProxy) {
      callback({});
      return;
    }

    const { userSessionId, password } = await getConfig();
    if (!userSessionId || !password) {
      console.log('[forward-proxy-session] authSkipped: credentials empty — save in popup first');
      callback({});
      return;
    }

    if (!isOurProxyChallenge(details)) {
      console.log('[forward-proxy-session] authIgnored: challenger does not match configured proxy');
      callback({});
      return;
    }

    console.log('[forward-proxy-session] authSupplied', {
      userSessionId: `${userSessionId.slice(0, 4)}...`,
    });
    callback(proxyAuthCredentials(userSessionId, password));
  })().catch((err) => {
    console.error('[forward-proxy-session] authError', err.message);
    callback({});
  });
}

function registerProxyAuthHandler() {
  if (registerProxyAuthHandler.registered) return;
  registerProxyAuthHandler.registered = true;

  chrome.webRequest.onAuthRequired.addListener(
    handleProxyAuth,
    { urls: ['<all_urls>'] },
    ['asyncBlocking']
  );
}

async function migrateLegacyStorage() {
  const local = await getConfig();
  const patch = {};

  if (!local.userSessionId) {
    const legacy = await new Promise((resolve) => {
      chrome.storage.local.get({ sessionId: '' }, resolve);
    });
    if (legacy.sessionId) {
      patch.userSessionId = legacy.sessionId;
    }
  }

  const legacySync = await new Promise((resolve) => {
    chrome.storage.sync.get(
      { sessionId: '', proxyHost: '', proxyPort: 0, proxyScheme: '' },
      resolve
    );
  });

  if (!patch.userSessionId && legacySync.sessionId) patch.userSessionId = legacySync.sessionId;
  if (local.proxyHost === DEFAULT_PROXY.host && legacySync.proxyHost) patch.proxyHost = legacySync.proxyHost;
  if (local.proxyPort === DEFAULT_PROXY.port && legacySync.proxyPort) patch.proxyPort = legacySync.proxyPort;
  if (local.proxyScheme === DEFAULT_PROXY.scheme && legacySync.proxyScheme) {
    patch.proxyScheme = legacySync.proxyScheme;
  }

  if (Object.keys(patch).length === 0) return;

  await new Promise((resolve) => chrome.storage.local.set(patch, resolve));
}

async function applyProxySettings() {
  const { proxyHost, proxyPort, proxyScheme } = await getConfig();
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: proxyScheme === 'https' ? 'https' : 'http',
        host: proxyHost,
        port: parseInt(proxyPort, 10) || 8080,
      },
      bypassList: ['<local>'],
    },
  };

  await new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value: config, scope: 'regular' }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function registerKeepAlive() {
  chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
      refresh().catch(console.error);
    }
  });
}

async function getRuleStatus() {
  const { userSessionId, password } = await getConfig();
  return {
    sessionDelivery: userSessionId && password ? 'webRequest.onAuthRequired' : 'none',
    hasCredentials: Boolean(userSessionId && password),
  };
}

async function refresh() {
  await migrateLegacyStorage();
  registerProxyAuthHandler();
  const { userSessionId, password } = await getConfig();
  await applyProxySettings();
  const status = await getRuleStatus();
  console.log('[forward-proxy-session] refreshed', {
    userSessionId: userSessionId ? `${userSessionId.slice(0, 4)}...` : '(empty)',
    hasPassword: Boolean(password),
    ...status,
  });
  return status;
}

chrome.runtime.onInstalled.addListener(() => {
  registerKeepAlive();
  refresh().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  registerKeepAlive();
  refresh().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (
    changes.proxyHost ||
    changes.proxyPort ||
    changes.proxyScheme ||
    changes.userSessionId ||
    changes.password
  ) {
    refresh().catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'refresh') {
    refresh()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'applySessionRules') {
    refresh()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'getStatus') {
    Promise.all([getConfig(), getRuleStatus()])
      .then(([config, status]) => sendResponse({ ok: true, config, status }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

registerKeepAlive();
registerProxyAuthHandler();
refresh().catch(console.error);
