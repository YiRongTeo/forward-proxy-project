'use strict';

function parseProxyAuth(req) {
  const proxyAuth = req.headers['proxy-authorization'];
  if (!proxyAuth || !proxyAuth.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(proxyAuth.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    const username = decoded.slice(0, idx).trim();
    const password = decoded.slice(idx + 1);
    if (!username) return null;
    return { userSessionId: username, password };
  } catch {
    return null;
  }
}

function hasProxyAuth(req) {
  return parseProxyAuth(req) !== null;
}

module.exports = { parseProxyAuth, hasProxyAuth };
