'use strict';

const IoValkey = require('iovalkey');

class SessionStore {
  constructor(options) {
    this.client = new IoValkey(options.valkeyUrl, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    this.cache = new Map();
    this.cacheTtlMs = options.cacheTtlMs || 30000;
  }

  key(id) {
    return `session:${id}`;
  }

  async ping() {
    return this.client.ping();
  }

  getCached(id) {
    const entry = this.cache.get(id);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(id);
      return null;
    }
    return entry.session;
  }

  setCache(id, session) {
    this.cache.set(id, {
      session,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  async getSession(id) {
    const cached = this.getCached(id);
    if (cached) return cached;

    const raw = await this.client.get(this.key(id));
    if (!raw) return null;

    const session = JSON.parse(raw);
    this.setCache(id, session);
    return session;
  }
}

module.exports = { SessionStore };
