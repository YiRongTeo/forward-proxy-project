'use strict';

const crypto = require('crypto');
const { createValkeyClient } = require('./valkeyClient');
const { hostSuffixCandidates } = require('./domainMatch');

const ERR_DOMAIN_NOT_ALLOWED = 'domain_not_allowed';
const ERR_INVALID_CREDENTIALS = 'invalid_credentials';

class SessionStore {
  constructor(options) {
    this.client = createValkeyClient(options.valkey);
    this.prefix = options.sessionsPrefix || 'sessions';
    this.cache = new Map();
    this.cacheTtlMs = options.cacheTtlMs || 30000;
  }

  domainKey(userSessionId, domain) {
    return `${this.prefix}:${userSessionId}:${domain}`;
  }

  async ping() {
    return this.client.ping();
  }

  getCached(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  setCache(key, value, found) {
    this.cache.set(key, { value, found, expiresAt: Date.now() + this.cacheTtlMs });
  }

  async lookupDomainValue(userSessionId, domain) {
    const key = this.domainKey(userSessionId, domain);
    const cached = this.getCached(key);
    if (cached) {
      return cached;
    }

    const raw = await this.client.get(key);
    const found = raw !== null;
    this.setCache(key, raw || '', found);
    return { value: raw || '', found };
  }

  timingSafeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }

  async authorizeDomainKey(userSessionId, password, requestedHost) {
    for (const candidate of hostSuffixCandidates(requestedHost)) {
      const { value, found } = await this.lookupDomainValue(userSessionId, candidate);
      if (!found) continue;
      if (this.timingSafeEqual(value, password)) {
        return candidate;
      }
      const err = new Error(ERR_INVALID_CREDENTIALS);
      err.code = ERR_INVALID_CREDENTIALS;
      throw err;
    }
    const err = new Error(ERR_DOMAIN_NOT_ALLOWED);
    err.code = ERR_DOMAIN_NOT_ALLOWED;
    throw err;
  }

  async listUserDomains(userSessionId) {
    const pattern = `${this.prefix}:${userSessionId}:*`;
    const prefix = `${this.prefix}:${userSessionId}:`;
    const domains = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        if (key.startsWith(prefix)) {
          domains.push(key.slice(prefix.length));
        }
      }
    } while (cursor !== '0');

    return domains;
  }
}

module.exports = {
  SessionStore,
  ERR_DOMAIN_NOT_ALLOWED,
  ERR_INVALID_CREDENTIALS,
};
