'use strict';

const { createServer } = require('./tls');
const { sendJson } = require('./util');

function createAdminServer(sessionStore, tlsOptions) {
  return createServer(tlsOptions, async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      try {
        await sessionStore.ping();
        sendJson(res, 200, { status: 'ok', tls: Boolean(tlsOptions) });
      } catch (err) {
        sendJson(res, 503, { status: 'error', message: err.message });
      }
      return;
    }

    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === 'GET') {
      const userSessionId = decodeURIComponent(sessionMatch[1]);
      try {
        const domains = await sessionStore.listUserDomains(userSessionId);
        if (domains.length === 0) {
          sendJson(res, 404, { error: 'session_not_found' });
          return;
        }
        sendJson(res, 200, { userSessionId, domains });
      } catch (err) {
        console.error(err);
        sendJson(res, 502, { error: 'internal_error' });
      }
      return;
    }

    if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH') {
      sendJson(res, 405, { error: 'method_not_allowed', message: 'Sessions are read-only via the proxy' });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });
}

module.exports = { createAdminServer };
