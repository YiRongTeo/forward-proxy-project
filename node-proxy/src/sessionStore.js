'use strict';

const { createValkeyClient } = require('./valkeyClient');
const { hostSuffixCandidates } = require('./domainMatch');

const ERR_DOMAIN_NOT_ALLOWED = 'domain_not_allowed';

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

  setCache(key, exists) {
    this.cache.set(key, { exists, expiresAt: Date.now() + this.cacheTtlMs });
  }

  async domainKeyExists(userSessionId, domain) {
    const key = this.domainKey(userSessionId, domain);
    const cached = this.getCached(key);
    if (cached) {
      return cached.exists;
    }

    const count = await this.client.exists(key);
    const exists = count > 0;
    this.setCache(key, exists);
    return exists;
  }

  async authorizeDomain(userSessionId, requestedHost) {
    for (const candidate of hostSuffixCandidates(requestedHost)) {
      if (await this.domainKeyExists(userSessionId, candidate)) {
        return candidate;
      }
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
};
