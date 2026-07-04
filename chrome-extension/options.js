const hostInput = document.getElementById('proxyHost');
const portInput = document.getElementById('proxyPort');
const schemeInput = document.getElementById('proxyScheme');
const statusEl = document.getElementById('status');

function proxyEndpoint() {
  return parseProxySettings(
    hostInput.value,
    portInput.value,
    schemeInput.value === 'https' ? 'https' : 'http'
  );
}

chrome.storage.local.get(
  { proxyHost: '127.0.0.1', proxyPort: 8080, proxyScheme: 'http' },
  (cfg) => {
    try {
      const parsed = parseProxySettings(cfg.proxyHost, cfg.proxyPort, cfg.proxyScheme);
      hostInput.value = parsed.proxyHost;
      portInput.value = parsed.proxyPort;
      schemeInput.value = parsed.proxyScheme === 'https' ? 'https' : 'http';
    } catch (_err) {
      hostInput.value = cfg.proxyHost;
      portInput.value = cfg.proxyPort;
      schemeInput.value = cfg.proxyScheme === 'https' ? 'https' : 'http';
    }
  }
);

document.getElementById('save').addEventListener('click', () => {
  let parsed;
  try {
    parsed = proxyEndpoint();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = '#a00';
    return;
  }

  statusEl.style.color = '#0a0';
  chrome.storage.local.set(parsed, () => {
    chrome.runtime.sendMessage({ type: 'refresh' }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        statusEl.textContent =
          response?.error || chrome.runtime.lastError?.message || 'Failed to apply proxy settings.';
        statusEl.style.color = '#a00';
        return;
      }
      hostInput.value = parsed.proxyHost;
      portInput.value = parsed.proxyPort;
      statusEl.textContent = `Saved. Proxy ${parsed.proxyScheme}://${parsed.proxyHost}:${parsed.proxyPort}`;
    });
  });
});

document.getElementById('test').addEventListener('click', async () => {
  let parsed;
  try {
    parsed = proxyEndpoint();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = '#a00';
    return;
  }

  const url = `${parsed.proxyScheme}://${parsed.proxyHost}:${parsed.proxyPort}/`;
  statusEl.style.color = '#0a0';
  statusEl.textContent = `Testing ${url} ...`;

  try {
    await fetch(url, { method: 'GET', mode: 'no-cors' });
    statusEl.textContent =
      `Proxy port reachable at ${url}. ` +
      (parsed.proxyScheme === 'http'
        ? 'If Chrome still fails, reload the extension and confirm scheme/port match the server config.'
        : 'HTTPS proxy responded. If Chrome still fails, the certificate may be untrusted — use http or install a trusted cert.');
  } catch (err) {
    statusEl.textContent =
      `Cannot reach proxy at ${url}: ${err.message}. ` +
      'Check: service running, correct host/port (Go=8081), http vs https, firewall, and use the server IP when Chrome is on another machine.';
  }
});
