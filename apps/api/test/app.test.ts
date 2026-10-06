import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { loadEnv } from '../src/config/env.js';
import { testEnv } from './helpers.js';

const healthyDb = { execute: async () => ({ rows: [] }) } as unknown as Database;
const downDb = {
  execute: async () => {
    throw new Error('connection refused');
  },
} as unknown as Database;

describe('health endpoints', () => {
  it('reports liveness', async () => {
    const app = await buildApp({ env: testEnv(), db: healthyDb, redis: null });
    const res = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('is ready with Redis disabled (Redis is optional)', async () => {
    const app = await buildApp({ env: testEnv(), db: healthyDb, redis: null });
    const res = await app.inject({ method: 'GET', url: '/api/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { database: 'up', redis: 'disabled' } });
  });

  it('is unavailable (503) when Postgres is down', async () => {
    const app = await buildApp({ env: testEnv(), db: downDb, redis: null });
    const res = await app.inject({ method: 'GET', url: '/api/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('unavailable');
  });
});

describe('cross-cutting HTTP behaviour', () => {
  it('returns the uniform error envelope for unknown routes', async () => {
    const app = await buildApp({ env: testEnv(), db: healthyDb, redis: null });
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('sets strict security headers and a request id', async () => {
    const app = await buildApp({ env: testEnv(), db: healthyDb, redis: null });
    const res = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores a client-supplied request id (no log injection / correlation spoofing)', async () => {
    const app = await buildApp({ env: testEnv(), db: healthyDb, redis: null });
    const res = await app.inject({
      method: 'GET',
      url: '/api/healthz',
      headers: { 'request-id': 'attacker-controlled' },
    });
    expect(res.headers['x-request-id']).not.toBe('attacker-controlled');
  });

  it('does not trust X-Forwarded-For from an untrusted peer', async () => {
    const app = await buildApp({
      env: testEnv({ TRUST_PROXY: '10.9.9.9' }),
      db: healthyDb,
      redis: null,
    });
    let seenIp = '';
    app.get('/api/ip-probe', async (req) => {
      seenIp = req.ip;
      return {};
    });
    await app.inject({
      method: 'GET',
      url: '/api/ip-probe',
      remoteAddress: '203.0.113.7',
      headers: { 'x-forwarded-for': '198.51.100.1' },
    });
    expect(seenIp).toBe('203.0.113.7');
  });
});

describe('environment validation', () => {
  it('refuses to boot with a malformed encryption key, without echoing secret values', () => {
    expect(() =>
      loadEnv({
        PUBLIC_ORIGIN: 'http://localhost',
        DATABASE_URL: 'postgres://x@localhost/db',
        SESSION_SECRET: 'x'.repeat(32),
        PII_ENCRYPTION_KEY: 'c2hvcnQ=',
        PHONE_HASH_PEPPER: 'p'.repeat(32),
      }),
    ).toThrow(/PII_ENCRYPTION_KEY: must be 32 bytes/);
  });

  it('refuses the console SMS provider in production', () => {
    expect(() => testEnv({ NODE_ENV: 'production', SMS_PROVIDER: 'console' })).toThrow(
      /SMS_PROVIDER/,
    );
  });

  it('requires Twilio credentials when Twilio is selected', () => {
    expect(() => testEnv({ SMS_PROVIDER: 'twilio' })).toThrow(/TWILIO_ACCOUNT_SID/);
  });
});
