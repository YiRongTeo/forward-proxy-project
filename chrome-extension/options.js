const hostInput = document.getElementById('proxyHost');
const portInput = document.getElementById('proxyPort');
const schemeInput = document.getElementById('proxyScheme');
const statusEl = document.getElementById('status');

function proxyEndpoint() {
  const proxyHost = hostInput.value.trim() || '127.0.0.1';
  const proxyPort = parseInt(portInput.value, 10) || 8080;
  const proxyScheme = schemeInput.value === 'https' ? 'https' : 'http';
  return { proxyHost, proxyPort, proxyScheme, url: `${proxyScheme}://${proxyHost}:${proxyPort}/` };
}

chrome.storage.local.get(
  { proxyHost: '127.0.0.1', proxyPort: 8080, proxyScheme: 'http' },
  (cfg) => {
    hostInput.value = cfg.proxyHost;
    portInput.value = cfg.proxyPort;
    schemeInput.value = cfg.proxyScheme === 'https' ? 'https' : 'http';
  }
);

document.getElementById('save').addEventListener('click', () => {
  const { proxyHost, proxyPort, proxyScheme } = proxyEndpoint();
  chrome.storage.local.set({ proxyHost, proxyPort, proxyScheme }, () => {
    chrome.runtime.sendMessage({ type: 'refresh' }, () => {
      statusEl.textContent = 'Saved. Proxy settings applied.';
    });
  });
});

document.getElementById('test').addEventListener('click', async () => {
  const { url, proxyScheme } = proxyEndpoint();
  statusEl.textContent = `Testing ${url} ...`;

  try {
    await fetch(url, { method: 'GET', mode: 'no-cors' });
    statusEl.textContent =
      `Proxy port reachable at ${url}. ` +
      (proxyScheme === 'http'
        ? 'If Chrome still fails, reload the extension and confirm scheme/port match the server config.'
        : 'HTTPS proxy responded. If Chrome still fails, the certificate may be untrusted — use http or install a trusted cert.');
  } catch (err) {
    statusEl.textContent =
      `Cannot reach proxy at ${url}: ${err.message}. ` +
      'Check: service running, correct host/port (Go=8081), http vs https, firewall, and use the server IP when Chrome is on another machine.';
  }
});
