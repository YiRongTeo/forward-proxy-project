const sessionInput = document.getElementById('sessionId');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');

function renderStatus(response) {
  if (!response?.ok) {
    metaEl.textContent = response?.error || 'Unable to read extension status.';
    return;
  }

  const { config, status } = response;
  const warnings = [];
  if (!config.sessionId) {
    warnings.push('No session ID saved');
  }
  if (status.proxyMatches === false) {
    warnings.push('Chrome proxy differs from extension settings — open Options and Save');
  }
  if (status.proxyControl && status.proxyControl !== 'controlled_by_this_extension') {
    warnings.push(`Proxy control=${status.proxyControl} — disable other proxy extensions`);
  }
  metaEl.textContent = [
    `Proxy: ${config.proxyScheme}://${config.proxyHost}:${config.proxyPort}`,
    `Active: ${status.activeProxy || 'unknown'}`,
    `Control: ${status.proxyControl || 'unknown'}`,
    `CONNECT auth: ${status.connectAuth || 'none'}`,
    `Requests seen: ${status.requestActivityCount ?? 0}`,
    warnings.length ? `⚠ ${warnings.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

function loadStatus() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, renderStatus);
}

chrome.storage.local.get({ sessionId: '' }, ({ sessionId }) => {
  sessionInput.value = sessionId;
  loadStatus();
});

document.getElementById('save').addEventListener('click', () => {
  const sessionId = sessionInput.value.trim();

  chrome.storage.local.set({ sessionId }, () => {
    chrome.runtime.sendMessage(
      { type: 'applySessionRules', sessionId },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          statusEl.textContent =
            response?.error ||
            chrome.runtime.lastError?.message ||
            'Failed to apply session rules.';
          return;
        }

        statusEl.textContent = sessionId
          ? 'Saved. HTTP header rules and CONNECT proxy auth applied.'
          : 'Cleared.';
        renderStatus(response);
        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      }
    );
  });
});
