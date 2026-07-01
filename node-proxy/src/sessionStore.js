'use strict';

const crypto = require('crypto');
const IoValkey = require('iovalkey');

class SessionStore {
  constructor(options) {
    this.ttlSeconds = options.ttlSeconds;
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

  invalidateCache(id) {
    this.cache.delete(id);
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

  async createSession({ id, domain, ttlSeconds, metadata }) {
    const sessionId = id || crypto.randomUUID();
    const ttl = ttlSeconds || this.ttlSeconds;
    const session = {
      domain: domain.toLowerCase().trim(),
      createdAt: new Date().toISOString(),
      metadata: metadata || {},
    };

    await this.client.set(this.key(sessionId), JSON.stringify(session), 'EX', ttl);
    this.setCache(sessionId, session);

    return { id: sessionId, ...session, expiresIn: ttl };
  }

  async refreshSession(id) {
    const exists = await this.client.exists(this.key(id));
    if (!exists) return false;
    await this.client.expire(this.key(id), this.ttlSeconds);
    return true;
  }

  async deleteSession(id) {
    this.invalidateCache(id);
    const deleted = await this.client.del(this.key(id));
    return deleted > 0;
  }
}

module.exports = { SessionStore };
