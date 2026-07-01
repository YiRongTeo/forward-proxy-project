const SESSION_HEADER = 'x-session-id';
const HEADER_RULE_ID = 1;
const DEFAULT_PROXY = { host: 'localhost', port: 8080, scheme: 'http' };

const ALL_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      {
        sessionId: '',
        proxyHost: DEFAULT_PROXY.host,
        proxyPort: DEFAULT_PROXY.port,
        proxyScheme: DEFAULT_PROXY.scheme,
      },
      resolve
    );
  });
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

async function applySessionHeaderRule(sessionId) {
  await new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules(
      {
        removeRuleIds: [HEADER_RULE_ID],
        addRules: sessionId
          ? [
              {
                id: HEADER_RULE_ID,
                priority: 1,
                action: {
                  type: 'modifyHeaders',
                  requestHeaders: [
                    { header: SESSION_HEADER, operation: 'set', value: sessionId },
                  ],
                },
                condition: {
                  urlFilter: '|http*',
                  resourceTypes: ALL_RESOURCE_TYPES,
                },
              },
            ]
          : [],
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

function registerProxyAuthHandler() {
  if (registerProxyAuthHandler.registered) return;
  registerProxyAuthHandler.registered = true;

  chrome.webRequest.onAuthRequired.addListener(
    (details, callback) => {
      getConfig()
        .then(({ sessionId }) => {
          if (!sessionId) {
            callback({});
            return;
          }
          callback({
            authCredentials: {
              username: sessionId,
              password: 'session',
            },
          });
        })
        .catch(() => callback({}));
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking']
  );
}

async function refresh() {
  await migrateLegacySyncStorage();
  const { sessionId } = await getConfig();
  await applyProxySettings();
  await applySessionHeaderRule(sessionId);
  registerProxyAuthHandler();
  console.log('[forward-proxy-session] refreshed', {
    sessionId: sessionId ? `${sessionId.slice(0, 4)}...` : '(empty)',
  });
}

chrome.runtime.onInstalled.addListener(() => {
  refresh().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  refresh().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.proxyHost || changes.proxyPort || changes.proxyScheme || changes.sessionId) {
    refresh().catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'refresh') {
    refresh()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  return false;
});

refresh().catch(console.error);
