'use strict';

function getSessionIdFromHeader(req, sessionHeader) {
  const names = [
    sessionHeader.toLowerCase(),
    'x-session-id',
  ];

  for (const name of names) {
    const headerValue = req.headers[name];
    if (headerValue) {
      return (Array.isArray(headerValue) ? headerValue[0] : headerValue).trim();
    }
  }

  return '';
}

function getSessionIdFromProxyAuth(req) {
  const proxyAuth = req.headers['proxy-authorization'];
  if (proxyAuth && proxyAuth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(proxyAuth.slice(6), 'base64').toString('utf8');
      const username = decoded.split(':')[0];
      if (username) return username.trim();
    } catch {
      // ignore malformed auth header
    }
  }

  return '';
}

function resolveSessionId(req, sessionHeader, acceptProxyAuth) {
  const fromHeader = getSessionIdFromHeader(req, sessionHeader);
  if (fromHeader) return fromHeader;
  if (acceptProxyAuth) return getSessionIdFromProxyAuth(req);
  return '';
}

function getSessionId(req, sessionHeader) {
  return resolveSessionId(req, sessionHeader, true);
}

module.exports = {
  getSessionId,
  getSessionIdFromHeader,
  getSessionIdFromProxyAuth,
  resolveSessionId,
};
