const sessionInput = document.getElementById('sessionId');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');

function renderStatus(response) {
  if (!response?.ok) {
    metaEl.textContent = response?.error || 'Unable to read extension status.';
    return;
  }

  const { config, status } = response;
  metaEl.textContent = [
    `Proxy: ${config.proxyScheme}://${config.proxyHost}:${config.proxyPort}`,
    `Rules: ${status.dynamicRuleCount} dynamic, ${status.sessionRuleCount} session`,
  ].join(' | ');
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
          ? 'Saved. Session header rules applied.'
          : 'Cleared.';
        renderStatus(response);
        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      }
    );
  });
});
