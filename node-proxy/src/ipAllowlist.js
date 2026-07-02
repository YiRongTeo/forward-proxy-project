'use strict';

const net = require('net');

function parseCidr(entry) {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  if (!trimmed.includes('/')) {
    const ip = normalizeIp(trimmed);
    return ip ? { type: 'single', ip } : null;
  }

  const [base, prefixStr] = trimmed.split('/');
  const prefix = parseInt(prefixStr, 10);
  const ip = normalizeIp(base);
  if (!ip || Number.isNaN(prefix)) return null;

  if (ip.kind === 'ipv4') {
    if (prefix < 0 || prefix > 32) return null;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const addr = ipv4ToInt(ip.address);
    return { type: 'ipv4', network: addr & mask, mask };
  }

  if (prefix < 0 || prefix > 128) return null;
  const bytes = ipv6ToBytes(ip.address);
  return { type: 'ipv6', bytes, prefix };
}

function normalizeIp(value) {
  const kind = net.isIP(value);
  if (kind === 4) return { kind: 'ipv4', address: value };
  if (kind === 6) {
    let addr = value.toLowerCase();
    if (addr.startsWith('::ffff:')) {
      const mapped = addr.slice(7);
      if (net.isIP(mapped) === 4) return { kind: 'ipv4', address: mapped };
    }
    return { kind: 'ipv6', address: addr };
  }
  return null;
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function ipv6ToBytes(ip) {
  const expanded = expandIpv6(ip);
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    bytes.writeUInt16BE(parseInt(expanded[i], 16), i * 2);
  }
  return bytes;
}

function expandIpv6(ip) {
  const parts = ip.split('::');
  if (parts.length > 2) throw new Error('invalid ipv6');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  const full = [...head, ...Array(missing).fill('0'), ...tail];
  return full.map((p) => p || '0');
}

function ipMatchesRule(ip, rule) {
  if (rule.type === 'single') {
    if (rule.ip.kind === 'ipv4' && ip.kind === 'ipv4') {
      return rule.ip.address === ip.address;
    }
    if (rule.ip.kind === 'ipv6' && ip.kind === 'ipv6') {
      return rule.ip.address === ip.address;
    }
    return false;
  }

  if (rule.type === 'ipv4' && ip.kind === 'ipv4') {
    const addr = ipv4ToInt(ip.address);
    return (addr & rule.mask) === rule.network;
  }

  if (rule.type === 'ipv6' && ip.kind === 'ipv6') {
    const bytes = ipv6ToBytes(ip.address);
    for (let i = 0; i < 16; i++) {
      const bitIndex = i * 8;
      if (bitIndex >= rule.prefix) break;
      const remaining = rule.prefix - bitIndex;
      const mask = remaining >= 8 ? 0xff : (~0 << (8 - remaining)) & 0xff;
      if ((bytes[i] & mask) !== (rule.bytes[i] & mask)) return false;
    }
    return true;
  }

  return false;
}

function createAllowlist(entries) {
  const rules = entries.map(parseCidr).filter(Boolean);

  function resolveClientIp(req, socket, trustProxyHeaders) {
    if (trustProxyHeaders) {
      const xff = req.headers['x-forwarded-for'];
      if (xff) {
        const first = xff.split(',')[0].trim();
        const ip = normalizeIp(first);
        if (ip) return ip;
      }
    }
    const remote = socket.remoteAddress || '127.0.0.1';
    return normalizeIp(remote) || { kind: 'ipv4', address: '127.0.0.1' };
  }

  function isAllowed(req, socket, trustProxyHeaders = false) {
    const ip = resolveClientIp(req, socket, trustProxyHeaders);
    return rules.some((rule) => ipMatchesRule(ip, rule));
  }

  return { isAllowed, resolveClientIp };
}

module.exports = { createAllowlist, normalizeIp };
