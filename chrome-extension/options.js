const hostInput = document.getElementById('proxyHost');
const portInput = document.getElementById('proxyPort');
const schemeInput = document.getElementById('proxyScheme');
const statusEl = document.getElementById('status');

chrome.storage.local.get(
  { proxyHost: 'localhost', proxyPort: 8080, proxyScheme: 'http' },
  (cfg) => {
    hostInput.value = cfg.proxyHost;
    portInput.value = cfg.proxyPort;
    schemeInput.value = cfg.proxyScheme === 'https' ? 'https' : 'http';
  }
);

document.getElementById('save').addEventListener('click', () => {
  const proxyHost = hostInput.value.trim() || 'localhost';
  const proxyPort = parseInt(portInput.value, 10) || 8080;
  const proxyScheme = schemeInput.value === 'https' ? 'https' : 'http';
  chrome.storage.local.set({ proxyHost, proxyPort, proxyScheme }, () => {
    chrome.runtime.sendMessage({ type: 'refresh' }, () => {
      statusEl.textContent = 'Saved. Proxy settings applied.';
    });
  });
});
