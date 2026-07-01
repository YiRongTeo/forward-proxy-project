'use strict';

const fs = require('fs');

function loadTlsOptions() {
  const certPath = process.env.TLS_CERT_FILE;
  const keyPath = process.env.TLS_KEY_FILE;
  if (!certPath || !keyPath) return null;
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) return null;
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

function createServer(tlsOptions, handler) {
  if (tlsOptions) {
    const https = require('https');
    return https.createServer(tlsOptions, handler);
  }
  return require('http').createServer(handler);
}

module.exports = { loadTlsOptions, createServer };
