'use strict';

function getSessionId(req, sessionHeader) {
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

module.exports = { getSessionId };
