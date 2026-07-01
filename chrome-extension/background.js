const SESSION_HEADER = 'X-Session-ID';
const RULE_ID = 1;
const DEFAULT_PROXY = { host: 'localhost', port: 8080 };

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { sessionId: '', proxyHost: DEFAULT_PROXY.host, proxyPort: DEFAULT_PROXY.port },
      resolve
    );
  });
}

async function applyProxySettings() {
  const { proxyHost, proxyPort } = await getConfig();
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: 'http',
        host: proxyHost,
        port: parseInt(proxyPort, 10) || 8080,
      },
      bypassList: ['<local>'],
    },
  };

  return new Promise((resolve, reject) => {
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
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: sessionId
      ? [
          {
            id: RULE_ID,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: SESSION_HEADER, operation: 'set', value: sessionId },
              ],
            },
            condition: {
              regexFilter: '^https?://.*',
              resourceTypes: [
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
                'other',
              ],
            },
          },
        ]
      : [],
  });
}

async function refresh() {
  const { sessionId } = await getConfig();
  await applyProxySettings();
  await applySessionHeaderRule(sessionId);
}

chrome.runtime.onInstalled.addListener(() => {
  refresh().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.proxyHost || changes.proxyPort || changes.sessionId) {
    refresh().catch(console.error);
  }
});

refresh().catch(console.error);
