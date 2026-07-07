importScripts('rules.js');

const DEFAULT_PROXY = { host: 'localhost', port: 8080, scheme: 'http' };

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
      resolve
    );
  });
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

async function applyDynamicHeaderRules(userSessionId, password) {
  await new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules(
      {
        removeRuleIds: allRuleIds(DYNAMIC_RULE_IDS),
        addRules: buildDynamicHeaderRules(userSessionId, password),
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
  const [dynamicRules, sessionRules] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.declarativeNetRequest.getSessionRules(),
  ]);

  return {
    dynamicRuleCount: dynamicRules.length,
    sessionRuleCount: sessionRules.length,
    sessionDelivery: 'proxy-authorization via declarativeNetRequest',
  };
}

async function refresh() {
  await migrateLegacyStorage();
  const { userSessionId, password } = await getConfig();
  await applyProxySettings();
  await applyDynamicHeaderRules(userSessionId, password);
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
    const userSessionId = message.userSessionId || '';
    const password = message.password || '';
    chrome.declarativeNetRequest.updateSessionRules(
      {
        removeRuleIds: allRuleIds(SESSION_RULE_IDS),
        addRules: buildSessionHeaderRules(userSessionId, password),
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
