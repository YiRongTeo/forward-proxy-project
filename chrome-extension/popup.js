const userSessionIdInput = document.getElementById('userSessionId');
const passwordInput = document.getElementById('password');
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

chrome.storage.local.get({ userSessionId: '', password: '' }, ({ userSessionId, password }) => {
  userSessionIdInput.value = userSessionId;
  passwordInput.value = password;
  loadStatus();
});

document.getElementById('save').addEventListener('click', () => {
  const userSessionId = userSessionIdInput.value.trim();
  const password = passwordInput.value;

  chrome.storage.local.set({ userSessionId, password }, () => {
    chrome.runtime.sendMessage(
      { type: 'applySessionRules', userSessionId, password },
      (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          statusEl.textContent =
            response?.error ||
            chrome.runtime.lastError?.message ||
            'Failed to apply proxy credentials.';
          return;
        }

        statusEl.textContent = userSessionId
          ? 'Saved. Proxy credentials applied.'
          : 'Cleared.';
        renderStatus(response);
        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      }
    );
  });
});
