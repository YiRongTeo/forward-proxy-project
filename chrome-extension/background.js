importScripts('rules.js');

const DEFAULT_PROXY = { host: '127.0.0.1', port: 8080, scheme: 'http' };
const EVENT_LIMIT = 30;

const cachedConfig = {
  sessionId: '',
  proxyHost: DEFAULT_PROXY.host,
  proxyPort: DEFAULT_PROXY.port,
  proxyScheme: DEFAULT_PROXY.scheme,
};

const recentEvents = [];
let requestActivityCount = 0;

function formatLog(type, detail) {
  if (detail == null || detail === '') return `[forward-proxy-session] ${type}`;
  if (typeof detail === 'string') return `[forward-proxy-session] ${type}: ${detail}`;
  const parts = Object.entries(detail).map(([key, value]) => `${key}=${value}`);
  return `[forward-proxy-session] ${type}: ${parts.join(' ')}`;
}

function pushEvent(type, detail) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    detail,
  };
  recentEvents.unshift(entry);
  if (recentEvents.length > EVENT_LIMIT) recentEvents.length = EVENT_LIMIT;
  console.log(formatLog(type, detail));
}

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        sessionId: '',
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
  cachedConfig.sessionId = cfg.sessionId || '';
  cachedConfig.proxyHost = normalizeProxyHost(cfg.proxyHost || DEFAULT_PROXY.host);
  cachedConfig.proxyPort = parseInt(cfg.proxyPort, 10) || DEFAULT_PROXY.port;
  cachedConfig.proxyScheme = cfg.proxyScheme || DEFAULT_PROXY.scheme;
}

function normalizeProxyHost(host) {
  if (!host) return DEFAULT_PROXY.host;
  const value = host.trim().toLowerCase();
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1') {
    return '127.0.0.1';
  }
  return host.trim();
}

function normalizeHost(host) {
  if (!host) return '';
  const value = host.toLowerCase();
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1') {
    return 'loopback';
  }
  return value;
}

function proxyEndpointLabel(scheme, host, port) {
  return `${scheme}://${normalizeProxyHost(host)}:${port}`;
}

function isOurProxyChallenge(details) {
  if (details.isProxy) return true;

  const challenger = details.challenger || {};
  const challengerPort = parseInt(challenger.port, 10);
  const expectedPort = cachedConfig.proxyPort || DEFAULT_PROXY.port;
  if (challengerPort !== expectedPort) return false;

  return normalizeHost(challenger.host) === normalizeHost(cachedConfig.proxyHost);
}

function proxyAuthCredentials(sessionId) {
  return {
    authCredentials: {
      username: sessionId,
      password: 'session',
    },
  };
}

function handleProxyAuth(details, callback) {
  (async () => {
    pushEvent('onAuthRequired', {
      isProxy: details.isProxy,
      challenger: details.challenger?.host
        ? `${details.challenger.host}:${details.challenger.port || ''}`
        : '(none)',
      method: details.method,
      url: details.url,
    });

    if (!details.isProxy) {
      pushEvent('authIgnored', 'not a proxy challenge');
      callback({});
      return;
    }

    const { sessionId } = await getConfig();
    if (!sessionId) {
      pushEvent('authSkipped', 'sessionId empty — save session in popup first');
      callback({});
      return;
    }

    if (!isOurProxyChallenge(details)) {
      pushEvent('authIgnored', 'challenger does not match configured proxy');
      callback({});
      return;
    }

    pushEvent('authSupplied', sessionId.slice(0, 4) + '...');
    callback(proxyAuthCredentials(sessionId));
  })().catch((err) => {
    pushEvent('authError', err.message);
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

function registerDiagnosticListeners() {
  if (registerDiagnosticListeners.registered) return;
  registerDiagnosticListeners.registered = true;

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.method === 'CONNECT') {
        pushEvent('CONNECT', { url: details.url, tabId: details.tabId });
      }
    },
    { urls: ['<all_urls>'] }
  );

  chrome.webRequest.onCompleted.addListener(
    () => {
      requestActivityCount += 1;
    },
    { urls: ['<all_urls>'] }
  );

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.statusCode === 407) {
        pushEvent('407 response', {
          url: details.url,
          method: details.method,
          isProxy: details.isProxy,
        });
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      if (details.error && /PROXY|407|AUTH/i.test(details.error)) {
        pushEvent('proxyError', { url: details.url, error: details.error });
      }
    },
    { urls: ['<all_urls>'] }
  );
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    pushEvent('offscreenUnavailable', 'offscreen permission missing');
    return;
  }

  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Keep the service worker active for proxy authentication callbacks',
    });
    pushEvent('offscreenCreated', 'keepalive document ready');
  } catch (err) {
    pushEvent('offscreenFailed', err.message);
  }
}

async function migrateLegacySyncStorage() {
  const legacy = await new Promise((resolve) => {
    chrome.storage.sync.get(
      { sessionId: '', proxyHost: '', proxyPort: 0, proxyScheme: '' },
      resolve
    );
  });

  const local = await getConfig();
  const patch = {};

  if (!local.sessionId && legacy.sessionId) patch.sessionId = legacy.sessionId;
  if (local.proxyHost === DEFAULT_PROXY.host && legacy.proxyHost) {
    patch.proxyHost = normalizeProxyHost(legacy.proxyHost);
  }
  if (local.proxyPort === DEFAULT_PROXY.port && legacy.proxyPort) patch.proxyPort = legacy.proxyPort;
  if (local.proxyScheme === DEFAULT_PROXY.scheme && legacy.proxyScheme) {
    patch.proxyScheme = legacy.proxyScheme;
  }

  if (Object.keys(patch).length === 0) return;

  await new Promise((resolve) => chrome.storage.local.set(patch, resolve));
  syncCachedConfig({ ...local, ...patch });
}

async function readActiveProxySettings() {
  return new Promise((resolve) => {
    chrome.proxy.settings.get({ incognito: false }, (details) => resolve(details));
  });
}

async function applyProxySettings() {
  const { proxyHost, proxyPort, proxyScheme } = cachedConfig;
  const host = normalizeProxyHost(proxyHost);
  const port = parseInt(proxyPort, 10) || DEFAULT_PROXY.port;
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: proxyScheme === 'https' ? 'https' : 'http',
        host,
        port,
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

  const details = await readActiveProxySettings();
  const configured = proxyEndpointLabel(proxyScheme, host, port);
  const activeProxy = details?.value?.rules?.singleProxy;
  const activeLabel = activeProxy
    ? proxyEndpointLabel(activeProxy.scheme, activeProxy.host, activeProxy.port)
    : '(none)';

  pushEvent('proxyApplied', {
    configured,
    active: activeLabel,
    matches: configured === activeLabel,
    control: details?.levelOfControl || 'unknown',
  });
}

async function applyDynamicHeaderRules(sessionId) {
  await new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules(
      {
        removeRuleIds: allRuleIdsToRemove(DYNAMIC_RULE_IDS),
        addRules: buildDynamicHeaderRules(sessionId),
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function registerKeepAlive() {
  chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
      refresh().catch((err) => pushEvent('refreshError', err.message));
    }
  });
}

async function getRuleStatus() {
  const [dynamicRules, sessionRules, proxyDetails] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.declarativeNetRequest.getSessionRules(),
    readActiveProxySettings(),
  ]);

  const configured = proxyEndpointLabel(
    cachedConfig.proxyScheme,
    cachedConfig.proxyHost,
    cachedConfig.proxyPort
  );
  const activeProxy = proxyDetails?.value?.rules?.singleProxy;
  const activeLabel = activeProxy
    ? proxyEndpointLabel(activeProxy.scheme, activeProxy.host, activeProxy.port)
    : '(none)';

  return {
    dynamicRuleCount: dynamicRules.length,
    sessionRuleCount: sessionRules.length,
    connectAuth: cachedConfig.sessionId ? 'webRequest.onAuthRequired' : 'none',
    configuredProxy: configured,
    activeProxy: activeLabel,
    proxyMatches: configured === activeLabel,
    proxyControl: proxyDetails?.levelOfControl || 'unknown',
    requestActivityCount,
    recentEvents: recentEvents.slice(0, 10),
  };
}

async function refresh() {
  await migrateLegacySyncStorage();
  await ensureOffscreenDocument();
  const { sessionId } = await getConfig();
  await applyProxySettings();
  await applyDynamicHeaderRules(sessionId);
  const status = await getRuleStatus();

  const controlOk = status.proxyControl === 'controlled_by_this_extension';
  pushEvent('refreshed', [
    `session=${sessionId ? sessionId.slice(0, 4) + '...' : '(empty)'}`,
    `proxy=${status.configuredProxy}`,
    `active=${status.activeProxy}`,
    `control=${status.proxyControl}`,
    controlOk ? 'ok' : 'WARN proxy not controlled by this extension',
    `requestsSeen=${status.requestActivityCount}`,
  ].join(' '));

  return status;
}

registerProxyAuthHandler();
registerDiagnosticListeners();
getConfig().catch((err) => pushEvent('startupError', err.message));

chrome.runtime.onInstalled.addListener(() => {
  registerKeepAlive();
  refresh().catch((err) => pushEvent('refreshError', err.message));
});

chrome.runtime.onStartup.addListener(() => {
  registerKeepAlive();
  refresh().catch((err) => pushEvent('refreshError', err.message));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.sessionId) {
    cachedConfig.sessionId = changes.sessionId.newValue || '';
  }
  if (changes.proxyHost) {
    cachedConfig.proxyHost = normalizeProxyHost(changes.proxyHost.newValue || DEFAULT_PROXY.host);
  }
  if (changes.proxyPort) {
    cachedConfig.proxyPort = parseInt(changes.proxyPort.newValue, 10) || DEFAULT_PROXY.port;
  }
  if (changes.proxyScheme) {
    cachedConfig.proxyScheme = changes.proxyScheme.newValue || DEFAULT_PROXY.scheme;
  }
  if (changes.proxyHost || changes.proxyPort || changes.proxyScheme || changes.sessionId) {
    refresh().catch((err) => pushEvent('refreshError', err.message));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'keepAlivePing') {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'refresh') {
    refresh()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === 'applySessionRules') {
    const sessionId = message.sessionId || '';
    cachedConfig.sessionId = sessionId;
    chrome.declarativeNetRequest.updateSessionRules(
      {
        removeRuleIds: allRuleIdsToRemove(SESSION_RULE_IDS),
        addRules: buildSessionHeaderRules(sessionId),
      },
      () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        refresh()
          .then((status) => sendResponse({ ok: true, status }))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
      }
    );
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
refresh().catch((err) => pushEvent('refreshError', err.message));
