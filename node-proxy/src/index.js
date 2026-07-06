'use strict';

const http = require('http');
const { loadConfig } = require('./config');
const { SessionStore } = require('./sessionStore');
const { useSentinel } = require('./valkeyClient');
const { createAllowlist } = require('./ipAllowlist');
const { createProxyHandler, handleConnect } = require('./proxyHandler');
const { createAdminServer } = require('./admin');
const { loadTlsOptions, createServer } = require('./tls');

const config = loadConfig();
const tlsOptions = loadTlsOptions(config.tls);

const valkeyMode = useSentinel(config.valkey)
  ? `sentinel:${config.valkey.sentinel.masterName}`
  : `direct:${config.valkey.url}`;
console.log(JSON.stringify({ msg: 'valkey configured', mode: valkeyMode }));

const sessionStore = new SessionStore({ valkey: config.valkey });
const allowlist = createAllowlist(config.allowedClientIps);

const proxyOptions = {
  allowlist,
  trustProxyHeaders: config.trustProxyHeaders,
  sessionStore,
  sessionHeader: config.sessionHeader,
  requireSessionFromHeader: config.requireSessionFromHeader,
  acceptSessionFromProxyAuth: config.acceptSessionFromProxyAuth,
  timeoutMs: config.proxyTimeoutMs,
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
  console.log(JSON.stringify({
    msg: label,
    port,
    tls: Boolean(tlsOptions),
    config: config.configPath,
  }));
}

proxyServer.listen(config.proxyPort, '0.0.0.0', () => {
  logListen('node forward proxy listening', config.proxyPort);
});

adminServer.listen(config.adminPort, '0.0.0.0', () => {
  logListen('node admin API listening', config.adminPort);
});

process.on('SIGTERM', async () => {
  proxyServer.close();
  adminServer.close();
  process.exit(0);
});
