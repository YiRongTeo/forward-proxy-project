const sessionInput = document.getElementById('sessionId');
const statusEl = document.getElementById('status');

chrome.storage.sync.get({ sessionId: '' }, ({ sessionId }) => {
  sessionInput.value = sessionId;
});

document.getElementById('save').addEventListener('click', () => {
  const sessionId = sessionInput.value.trim();
  chrome.storage.sync.set({ sessionId }, () => {
    statusEl.textContent = sessionId ? 'Saved.' : 'Cleared.';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});
