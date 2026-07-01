importScripts('rules.js');

const DEFAULT_PROXY = { host: 'localhost', port: 8080, scheme: 'http' };

const cachedConfig = {
  sessionId: '',
  proxyHost: DEFAULT_PROXY.host,
  proxyPort: DEFAULT_PROXY.port,
  proxyScheme: DEFAULT_PROXY.scheme,
};

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
  cachedConfig.proxyHost = cfg.proxyHost || DEFAULT_PROXY.host;
  cachedConfig.proxyPort = parseInt(cfg.proxyPort, 10) || DEFAULT_PROXY.port;
  cachedConfig.proxyScheme = cfg.proxyScheme || DEFAULT_PROXY.scheme;
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

function proxyAuthCredentials(sessionId) {
  return {
    authCredentials: {
      username: sessionId,
      password: 'session',
    },
  };
}

function handleProxyAuth(details) {
  console.log('[forward-proxy-session] onAuthRequired', {
    isProxy: details.isProxy,
    challenger: details.challenger,
    method: details.method,
    url: details.url,
    hasSession: Boolean(cachedConfig.sessionId),
    configuredProxy: `${cachedConfig.proxyScheme}://${cachedConfig.proxyHost}:${cachedConfig.proxyPort}`,
  });

  if (!cachedConfig.sessionId) {
    console.warn('[forward-proxy-session] proxy auth requested but sessionId is empty');
    return {};
  }

  if (isOurProxyChallenge(details)) {
    console.log('[forward-proxy-session] supplying Proxy-Authorization credentials');
    return proxyAuthCredentials(cachedConfig.sessionId);
  }

  console.warn('[forward-proxy-session] ignoring auth challenge (not our proxy)', details.challenger);
  return {};
}

function registerProxyAuthHandler() {
  if (registerProxyAuthHandler.registered) return;
  registerProxyAuthHandler.registered = true;

  chrome.webRequest.onAuthRequired.addListener(
    handleProxyAuth,
    { urls: ['<all_urls>'] },
    ['blocking']
  );
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
  if (local.proxyHost === DEFAULT_PROXY.host && legacy.proxyHost) patch.proxyHost = legacy.proxyHost;
  if (local.proxyPort === DEFAULT_PROXY.port && legacy.proxyPort) patch.proxyPort = legacy.proxyPort;
  if (local.proxyScheme === DEFAULT_PROXY.scheme && legacy.proxyScheme) {
    patch.proxyScheme = legacy.proxyScheme;
  }

  if (Object.keys(patch).length === 0) return;

  await new Promise((resolve) => chrome.storage.local.set(patch, resolve));
  syncCachedConfig({ ...local, ...patch });
}

async function applyProxySettings() {
  const { proxyHost, proxyPort, proxyScheme } = cachedConfig;
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: proxyScheme === 'https' ? 'https' : 'http',
        host: proxyHost,
        port: parseInt(proxyPort, 10) || DEFAULT_PROXY.port,
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
      refresh().catch(console.error);
    }
  });
}

async function getRuleStatus() {
  const [dynamicRules, sessionRules, proxySettings] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.declarativeNetRequest.getSessionRules(),
    new Promise((resolve) => {
      chrome.proxy.settings.get({ incognito: false }, (details) => resolve(details.value));
    }),
  ]);

  const configured = `${cachedConfig.proxyScheme}://${cachedConfig.proxyHost}:${cachedConfig.proxyPort}`;
  const activeProxy = proxySettings?.rules?.singleProxy;
  const active = activeProxy
    ? `${activeProxy.scheme}://${activeProxy.host}:${activeProxy.port}`
    : '(none)';

  return {
    dynamicRuleCount: dynamicRules.length,
    sessionRuleCount: sessionRules.length,
    connectAuth: cachedConfig.sessionId ? 'webRequest.onAuthRequired' : 'none',
    configuredProxy: configured,
    activeProxy: active,
    proxyMatches: configured === active,
  };
}

async function refresh() {
  await migrateLegacySyncStorage();
  const { sessionId } = await getConfig();
  await applyProxySettings();
  await applyDynamicHeaderRules(sessionId);
  const status = await getRuleStatus();
  console.log('[forward-proxy-session] refreshed', {
    sessionId: sessionId ? `${sessionId.slice(0, 4)}...` : '(empty)',
    connectAuth: status.connectAuth,
    configuredProxy: status.configuredProxy,
    activeProxy: status.activeProxy,
    proxyMatches: status.proxyMatches,
    ...status,
  });
  return status;
}

registerProxyAuthHandler();

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
  if (changes.sessionId) {
    cachedConfig.sessionId = changes.sessionId.newValue || '';
  }
  if (changes.proxyHost) {
    cachedConfig.proxyHost = changes.proxyHost.newValue || DEFAULT_PROXY.host;
  }
  if (changes.proxyPort) {
    cachedConfig.proxyPort = parseInt(changes.proxyPort.newValue, 10) || DEFAULT_PROXY.port;
  }
  if (changes.proxyScheme) {
    cachedConfig.proxyScheme = changes.proxyScheme.newValue || DEFAULT_PROXY.scheme;
  }
  if (changes.proxyHost || changes.proxyPort || changes.proxyScheme || changes.sessionId) {
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
refresh().catch(console.error);
