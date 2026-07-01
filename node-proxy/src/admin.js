'use strict';

const http = require('http');
const { sendJson } = require('./util');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createAdminServer(sessionStore) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      try {
        await sessionStore.ping();
        sendJson(res, 200, { status: 'ok' });
      } catch (err) {
        sendJson(res, 503, { status: 'error', message: err.message });
      }
      return;
    }

    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      if (req.method === 'GET') {
        const session = await sessionStore.getSession(id);
        if (!session) {
          sendJson(res, 404, { error: 'session_not_found' });
          return;
        }
        sendJson(res, 200, { id, ...session });
        return;
      }
      if (req.method === 'DELETE') {
        const deleted = await sessionStore.deleteSession(id);
        sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true, id } : { error: 'session_not_found' });
        return;
      }
    }

    if (req.method === 'POST' && url.pathname === '/sessions') {
      try {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (!body.domain) {
          sendJson(res, 400, { error: 'domain_required' });
          return;
        }
        const created = await sessionStore.createSession({
          id: body.id,
          domain: body.domain,
          ttlSeconds: body.ttlSeconds,
          metadata: body.metadata,
        });
        sendJson(res, 201, created);
      } catch (err) {
        sendJson(res, 400, { error: 'invalid_json', message: err.message });
      }
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });
}

module.exports = { createAdminServer };
