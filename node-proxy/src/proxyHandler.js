'use strict';

const http = require('http');
const net = require('net');
const { URL } = require('url');
const { isPublicHost } = require('./domainMatch');
const { parseProxyAuth, hasProxyAuth } = require('./sessionAuth');
const { ERR_DOMAIN_NOT_ALLOWED, ERR_INVALID_CREDENTIALS } = require('./sessionStore');
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
  if (auth.publicAccess) return 'public';
  return auth.openAccess ? 'open' : 'credential';
}

async function authorizeRequest(req, socket, options, requestedHost) {
  const { allowlist, trustProxyHeaders, sessionStore, requireProxyAuth, publicDomains } = options;

  if (!allowlist.isAllowed(req, socket, trustProxyHeaders)) {
    return { ok: false, status: 403, error: 'ip_not_allowed' };
  }

  if (isPublicHost(requestedHost, publicDomains)) {
    return { ok: true, publicAccess: true };
  }

  if (requireProxyAuth === false) {
    return { ok: true, openAccess: true };
  }

  const creds = parseProxyAuth(req);
  if (!creds) {
    return { ok: false, status: 403, error: 'missing_credentials' };
  }

  try {
    const matchedDomain = await sessionStore.authorizeDomainKey(
      creds.userSessionId,
      creds.password,
      requestedHost
    );
    return {
      ok: true,
      userSessionId: creds.userSessionId,
      matchedDomain,
    };
  } catch (err) {
    if (err.code === ERR_INVALID_CREDENTIALS) {
      return { ok: false, status: 403, error: 'invalid_credentials', userSessionId: creds.userSessionId };
    }
    if (err.code === ERR_DOMAIN_NOT_ALLOWED) {
      return { ok: false, status: 403, error: 'domain_not_allowed', userSessionId: creds.userSessionId };
    }
    console.error(err);
    return { ok: false, status: 502, error: 'internal_error', userSessionId: creds.userSessionId };
  }
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

  authorizeRequest(req, socket, options, host)
    .then((auth) => {
      if (!auth.ok) {
        const body = {
          error: auth.error,
          requestedHost: host,
        };
        if (auth.userSessionId) body.userSessionId = auth.userSessionId;
        sendJson(res, auth.status, body);
        logEvent({
          clientIp: socket.remoteAddress,
          userSessionId: auth.userSessionId || null,
          requestedHost: host,
          allowed: false,
          method: 'CONNECT',
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: auth.error,
          hasProxyAuth: hasProxyAuth(req),
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
          userSessionId: auth.userSessionId || null,
          matchedDomainKey: auth.matchedDomain,
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
          userSessionId: auth.userSessionId || null,
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

  let targetUrl;
  try {
    targetUrl = new URL(req.url);
  } catch {
    sendJson(res, 400, { error: 'invalid_request_url' });
    return;
  }

  const requestedHost = targetUrl.hostname;

  authorizeRequest(req, socket, options, requestedHost)
    .then(async (auth) => {
      if (!auth.ok) {
        const body = { error: auth.error };
        if (auth.userSessionId) body.userSessionId = auth.userSessionId;
        sendJson(res, auth.status, body);
        logEvent({
          clientIp: socket.remoteAddress,
          userSessionId: auth.userSessionId || null,
          allowed: false,
          method: req.method,
          authMode: authMode(auth),
          latencyMs: Date.now() - start,
          error: auth.error,
        });
        return;
      }

      const headers = stripHopByHop(req.headers);
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
          const responseHeaders = stripHopByHop(proxyRes.headers);
          res.writeHead(proxyRes.statusCode, responseHeaders);
          proxyRes.pipe(res);
          logEvent({
            clientIp: socket.remoteAddress,
            userSessionId: auth.userSessionId || null,
            matchedDomainKey: auth.matchedDomain,
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
          userSessionId: auth.userSessionId || null,
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
