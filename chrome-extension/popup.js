const sessionInput = document.getElementById('sessionId');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const eventsEl = document.getElementById('events');

function formatEvent(entry) {
  if (!entry) return '';
  const detail =
    typeof entry.detail === 'string'
      ? entry.detail
      : Object.entries(entry.detail || {})
          .map(([key, value]) => `${key}=${value}`)
          .join(' ');
  return `${entry.type}${detail ? ': ' + detail : ''}`;
}

function renderStatus(response) {
  if (!response?.ok) {
    metaEl.textContent = response?.error || 'Unable to read extension status.';
    eventsEl.textContent = '';
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

  eventsEl.textContent = (status.recentEvents || [])
    .map(formatEvent)
    .join('\n') || 'No events yet — browse a site, then reopen popup.';
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

document.getElementById('resetProxy').addEventListener('click', () => {
  statusEl.textContent = 'Resetting proxy...';
  chrome.runtime.sendMessage({ type: 'resetProxy' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      statusEl.textContent =
        response?.error || chrome.runtime.lastError?.message || 'Reset failed.';
      return;
    }
    statusEl.textContent = 'Proxy reset. Try browsing again (restart Chrome if still no 407).';
    renderStatus(response);
  });
});
