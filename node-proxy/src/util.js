'use strict';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHop(headers, sessionHeader) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === sessionHeader.toLowerCase()) continue;
    out[key] = value;
  }
  return out;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendProxyAuthRequired(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(407, 'Proxy Authentication Required', {
    'Proxy-Authenticate': 'Basic realm="forward-proxy"',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function logEvent(event) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

module.exports = { stripHopByHop, sendJson, sendProxyAuthRequired, logEvent, HOP_BY_HOP };
