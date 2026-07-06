'use strict';

const http = require('http');
const net = require('net');
const { URL } = require('url');
const { hostAllowed } = require('./domainMatch');
const { resolveSessionId, getSessionIdFromHeader, getSessionIdFromProxyAuth } = require('./sessionAuth');
const { stripHopByHop, sendJson, logEvent } = require('./util');

function parseConnectTarget(target) {
  const trimmed = target.trim();
  let host = trimmed;
  let port = 443;

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end !== -1) {
      host = trimmed.slice(1, end);
      const rest = trimmed.slice(end + 1);
      if (rest.startsWith(':')) port = parseInt(rest.slice(1), 10) || 443;
    }
  } else {
    const idx = trimmed.lastIndexOf(':');
    if (idx !== -1) {
      host = trimmed.slice(0, idx);
      port = parseInt(trimmed.slice(idx + 1), 10) || 443;
    }
  }

  return { host, port };
}

function authMode(auth) {
  return auth.openAccess ? 'open' : 'header';
}

async function authorizeRequest(req, socket, options) {
  const {
    allowlist,
    trustProxyHeaders,
    sessionStore,
    sessionHeader,
    requireSessionFromHeader,
    acceptSessionFromProxyAuth,
  } = options;

  if (!allowlist.isAllowed(req, socket, trustProxyHeaders)) {
    return { ok: false, status: 403, error: 'ip_not_allowed' };
  }

  if (requireSessionFromHeader === false) {
    return { ok: true, openAccess: true };
  }

  const sessionId = resolveSessionId(req, sessionHeader, acceptSessionFromProxyAuth);
  if (!sessionId) {
    return { ok: false, status: 403, error: 'missing_session_id' };
  }

  const session = await sessionStore.getSession(sessionId);
  if (!session) {
    return { ok: false, status: 404, error: 'session_not_found', sessionId };
  }

  return { ok: true, sessionId, session };
}

function tunnelSockets(clientSocket, upstream, head) {
  const cleanup = () => {
    clientSocket.removeListener('error', onError);
    upstream.removeListener('error', onError);
    clientSocket.unpipe(upstream);
    upstream.unpipe(clientSocket);
  };
  const onError = () => cleanup();
  clientSocket.on('error', onError);
  upstream.on('error', onError);
  if (head && head.length) upstream.write(head);
  upstream.pipe(clientSocket);
  clientSocket.pipe(upstream);
}

function handleConnect(req, res, socket, head, options) {
  const start = Date.now();
  const target = req.url || '';
  const { host, port } = parseConnectTarget(target);
  socket.on('error', () => {});

  authorizeRequest(req, socket, options)
    .then((auth) => {
      if (!auth.ok) {
        const body = {
          error: auth.error,
          requestedHost: host,
        };
        if (auth.sessionId) body.sessionId = auth.sessionId;
        sendJson(res, auth.status, body);
        logEvent({
          clientIp: socket.remoteAddress,
          sessionId: auth.sessionId || null,
          requestedHost: host,
          allowed: false,
          method: 'CONNECT',
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: auth.error,
          hasSessionHeader: Boolean(getSessionIdFromHeader(req, options.sessionHeader)),
          hasProxyAuth: Boolean(getSessionIdFromProxyAuth(req)),
        });
        return;
      }

      if (!auth.openAccess && !hostAllowed(host, auth.session.domain)) {
        sendJson(res, 403, {
          error: 'domain_not_allowed',
          sessionDomain: auth.session.domain,
          requestedHost: host,
          sessionId: auth.sessionId,
        });
        logEvent({
          clientIp: socket.remoteAddress,
          sessionId: auth.sessionId,
          sessionDomain: auth.session.domain,
          requestedHost: host,
          allowed: false,
          method: 'CONNECT',
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: 'domain_not_allowed',
        });
        return;
      }

      const upstream = net.connect({ host, port }, () => {
        if (typeof res.writeRaw === 'function') {
          res.writeRaw('HTTP/1.1 200 Connection Established\r\n\r\n');
        } else {
          res.writeHead(200, 'Connection Established', {});
          res.end();
        }
        tunnelSockets(socket, upstream, head);
        logEvent({
          clientIp: socket.remoteAddress,
          sessionId: auth.sessionId || null,
          sessionDomain: auth.session?.domain,
          requestedHost: host,
          allowed: true,
          method: 'CONNECT',
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
        });
      });

      upstream.setTimeout(options.timeoutMs, () => {
        upstream.destroy();
        socket.destroy();
      });

      upstream.on('error', () => {
        if (!res.headersSent) {
          sendJson(res, 502, { error: 'upstream_unreachable', requestedHost: host });
        } else {
          socket.destroy();
        }
        logEvent({
          clientIp: socket.remoteAddress,
          sessionId: auth.sessionId || null,
          requestedHost: host,
          allowed: true,
          method: 'CONNECT',
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: 'upstream_unreachable',
        });
      });
    })
    .catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 502, { error: 'internal_error' });
    });
}

function handleHttp(req, res, options) {
  const start = Date.now();
  const socket = req.socket;

  authorizeRequest(req, socket, options)
    .then(async (auth) => {
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error, sessionId: auth.sessionId });
        logEvent({
          clientIp: socket.remoteAddress,
          sessionId: auth.sessionId || null,
          allowed: false,
          method: req.method,
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: auth.error,
        });
        return;
      }

      let targetUrl;
      try {
        targetUrl = new URL(req.url);
      } catch {
        sendJson(res, 400, { error: 'invalid_request_url' });
        return;
      }

      const requestedHost = targetUrl.hostname;
      if (!auth.openAccess && !hostAllowed(requestedHost, auth.session.domain)) {
        sendJson(res, 403, {
          error: 'domain_not_allowed',
          sessionDomain: auth.session.domain,
          requestedHost,
          sessionId: auth.sessionId,
        });
        logEvent({
          clientIp: socket.remoteAddress,
          sessionId: auth.sessionId,
          sessionDomain: auth.session.domain,
          requestedHost,
          allowed: false,
          method: req.method,
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: 'domain_not_allowed',
        });
        return;
      }

      const headers = stripHopByHop(req.headers, options.sessionHeader);
      headers.host = targetUrl.host;

      const proxyReq = http.request(
        {
          protocol: targetUrl.protocol,
          hostname: targetUrl.hostname,
          port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
          method: req.method,
          path: targetUrl.pathname + targetUrl.search,
          headers,
          timeout: options.timeoutMs,
        },
        (proxyRes) => {
          const responseHeaders = stripHopByHop(proxyRes.headers, options.sessionHeader);
          res.writeHead(proxyRes.statusCode, responseHeaders);
          proxyRes.pipe(res);
          logEvent({
            clientIp: socket.remoteAddress,
            sessionId: auth.sessionId || null,
            sessionDomain: auth.session?.domain,
            requestedHost,
            allowed: true,
            method: req.method,
            authMode: authMode(auth),
            latencyMs: Date.now() - start,
            status: proxyRes.statusCode,
          });
        }
      );

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) sendJson(res, 504, { error: 'upstream_timeout' });
      });

      proxyReq.on('error', () => {
        if (!res.headersSent) sendJson(res, 502, { error: 'upstream_unreachable' });
        logEvent({
          clientIp: socket.remoteAddress,
          sessionId: auth.sessionId || null,
          requestedHost,
          allowed: true,
          method: req.method,
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: 'upstream_unreachable',
        });
      });

      req.pipe(proxyReq);
    })
    .catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 502, { error: 'internal_error' });
    });
}

function createProxyHandler(options) {
  return (req, res) => {
    if (req.method === 'CONNECT') {
      handleConnect(req, res, req.socket, Buffer.alloc(0), options);
      return;
    }
    handleHttp(req, res, options);
  };
}

module.exports = { createProxyHandler, handleConnect, handleHttp, authorizeRequest, parseConnectTarget };
