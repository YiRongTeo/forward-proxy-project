'use strict';

const http = require('http');
const { SessionStore } = require('./sessionStore');
const { createAllowlist } = require('./ipAllowlist');
const { createProxyHandler, handleConnect } = require('./proxyHandler');
const { createAdminServer } = require('./admin');
const { loadTlsOptions, createServer } = require('./tls');

const valkeyUrl = process.env.VALKEY_URL || 'redis://127.0.0.1:6379';
const timeoutMs = parseInt(process.env.PROXY_TIMEOUT_MS || '30000', 10);
const allowedIps = (process.env.ALLOWED_CLIENT_IPS || '127.0.0.1,::1').split(',');
const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true';
const sessionHeader = process.env.SESSION_HEADER || 'X-Session-ID';
const proxyPort = parseInt(process.env.PROXY_PORT || '8080', 10);
const adminPort = parseInt(process.env.ADMIN_PORT || '3001', 10);
const tlsOptions = loadTlsOptions();

const sessionStore = new SessionStore({ valkeyUrl });
const allowlist = createAllowlist(allowedIps);

const proxyOptions = {
  allowlist,
  trustProxyHeaders,
  sessionStore,
  sessionHeader,
  timeoutMs,
};

const proxyHandler = createProxyHandler(proxyOptions);

const proxyServer = createServer(tlsOptions, (req, res) => {
  if (req.method === 'CONNECT') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('CONNECT must use upgrade');
    return;
  }
  proxyHandler(req, res);
});

proxyServer.on('clientError', (_err, socket) => {
  if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

proxyServer.on('connect', (req, clientSocket, head) => {
  clientSocket.on('error', () => {});
  const fakeRes = {
    headersSent: false,
    writeHead(statusCode, statusMessage, headers) {
      this.headersSent = true;
      let hdrs = headers;
      let message = statusMessage;
      if (typeof statusMessage === 'object' && statusMessage !== null) {
        hdrs = statusMessage;
        message = undefined;
      }
      const statusText = http.STATUS_CODES[statusCode] || 'Error';
      let raw = `HTTP/1.1 ${statusCode} ${message || statusText}\r\n`;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          raw += `${k}: ${v}\r\n`;
        }
      }
      raw += '\r\n';
      clientSocket.write(raw);
    },
    writeRaw(raw) {
      this.headersSent = true;
      clientSocket.write(raw);
    },
    end(data) {
      if (data) clientSocket.write(data);
      if (!clientSocket.destroyed) clientSocket.end();
    },
  };

  handleConnect(req, fakeRes, clientSocket, head, proxyOptions);
});

const adminServer = createAdminServer(sessionStore, tlsOptions);

function logListen(label, port) {
  console.log(JSON.stringify({ msg: label, port, tls: Boolean(tlsOptions) }));
}

proxyServer.listen(proxyPort, '0.0.0.0', () => {
  logListen('node forward proxy listening', proxyPort);
});

adminServer.listen(adminPort, '0.0.0.0', () => {
  logListen('node admin API listening', adminPort);
});

process.on('SIGTERM', async () => {
  proxyServer.close();
  adminServer.close();
  process.exit(0);
});
