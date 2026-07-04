'use strict';

const fs = require('fs');

function loadTlsOptions(tlsConfig) {
  if (!tlsConfig?.enabled) return null;

  const tls = {};
  if (tlsConfig.caFile) {
    tls.ca = fs.readFileSync(tlsConfig.caFile);
  }
  if (tlsConfig.certFile && tlsConfig.keyFile) {
    tls.cert = fs.readFileSync(tlsConfig.certFile);
    tls.key = fs.readFileSync(tlsConfig.keyFile);
  }
  if (tlsConfig.serverName) {
    tls.serverName = tlsConfig.serverName;
  }
  if (tlsConfig.insecureSkipVerify) {
    tls.rejectUnauthorized = false;
  }
  return tls;
}

function tlsUrlScheme(url) {
  if (!url) return url;
  if (url.startsWith('redis://')) {
    return `rediss://${url.slice('redis://'.length)}`;
  }
  return url;
}

module.exports = { loadTlsOptions, tlsUrlScheme };
