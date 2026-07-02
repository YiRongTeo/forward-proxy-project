// Keeps the MV3 service worker reachable for synchronous onAuthRequired handling.
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'keepAlivePing' }).catch(() => {});
}, 20000);
