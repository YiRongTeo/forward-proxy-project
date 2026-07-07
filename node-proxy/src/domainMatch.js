'use strict';

function normalizeHost(host) {
  if (!host) return '';
  let h = host.toLowerCase().trim();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end !== -1) return h.slice(1, end);
  }
  const colon = h.lastIndexOf(':');
  if (colon !== -1 && h.indexOf(':') === colon) {
    h = h.slice(0, colon);
  }
  return h;
}

function hostAllowed(requestedHost, sessionDomain) {
  const host = normalizeHost(requestedHost);
  const domain = normalizeHost(sessionDomain);
  if (!host || !domain) return false;
  return host === domain || host.endsWith('.' + domain);
}

function isPublicHost(requestedHost, publicDomains) {
  return publicDomains.some((allowed) => hostAllowed(requestedHost, allowed));
}

function hostSuffixCandidates(requestedHost) {
  const host = normalizeHost(requestedHost);
  if (!host) return [];

  const out = [];
  for (let h = host; h; ) {
    out.push(h);
    const idx = h.indexOf('.');
    if (idx === -1) break;
    h = h.slice(idx + 1);
  }
  return out;
}

module.exports = {
  hostAllowed,
  normalizeHost,
  isPublicHost,
  hostSuffixCandidates,
};
