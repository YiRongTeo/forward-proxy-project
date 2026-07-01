const hostInput = document.getElementById('proxyHost');
const portInput = document.getElementById('proxyPort');
const statusEl = document.getElementById('status');

chrome.storage.sync.get({ proxyHost: 'localhost', proxyPort: 8080 }, (cfg) => {
  hostInput.value = cfg.proxyHost;
  portInput.value = cfg.proxyPort;
});

document.getElementById('save').addEventListener('click', () => {
  const proxyHost = hostInput.value.trim() || 'localhost';
  const proxyPort = parseInt(portInput.value, 10) || 8080;
  chrome.storage.sync.set({ proxyHost, proxyPort }, () => {
    statusEl.textContent = 'Saved. Proxy settings applied.';
  });
});
