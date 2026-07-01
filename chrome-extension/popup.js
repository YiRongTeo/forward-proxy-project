const sessionInput = document.getElementById('sessionId');
const statusEl = document.getElementById('status');

chrome.storage.local.get({ sessionId: '' }, ({ sessionId }) => {
  sessionInput.value = sessionId;
});

document.getElementById('save').addEventListener('click', () => {
  const sessionId = sessionInput.value.trim();
  chrome.storage.local.set({ sessionId }, () => {
    chrome.runtime.sendMessage({ type: 'refresh' }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        statusEl.textContent = 'Saved, but refresh failed. Reload the extension.';
        return;
      }
      statusEl.textContent = sessionId ? 'Saved. Session active.' : 'Cleared.';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 2500);
    });
  });
});
