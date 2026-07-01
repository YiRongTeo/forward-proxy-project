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

function requestHostAllowed(requestedHost, sessionDomain, defaultAllowedDomains = []) {
  if (hostAllowed(requestedHost, sessionDomain)) return true;
  if (!Array.isArray(defaultAllowedDomains)) return false;
  return defaultAllowedDomains.some((domain) => hostAllowed(requestedHost, domain));
}

module.exports = { hostAllowed, requestHostAllowed, normalizeHost };
