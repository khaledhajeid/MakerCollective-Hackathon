import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { testEnv } from './helpers.js';

/** Minimal drizzle stand-in: `select().from().where()` resolves to one settings row. */
function dbWith(row: Record<string, unknown>) {
  return {
    select: () => ({ from: () => ({ where: async () => [row] }) }),
  } as unknown as Database;
}
const base = { accessMode: 'IP_ALLOWLIST', venueCidrs: ['203.0.113.0/24'], wifiSsid: 'MC2026' };

async function status(row: Record<string, unknown>, remoteAddress: string, headers = {}) {
  // TRUST_PROXY = the Caddy hop, exactly like the real stack.
  const app = await buildApp({
    env: testEnv({ TRUST_PROXY: '172.28.0.10' }),
    db: dbWith({ ...base, ...row }),
    redis: null,
  });
  const res = await app.inject({
    method: 'GET',
    url: '/api/access/status',
    remoteAddress,
    headers,
  });
  return res.json();
}

describe('GET /api/access/status (F10/F11)', () => {
  it('admits a phone whose real IP (from Caddy) is inside the venue range', async () => {
    const r = await status({}, '172.28.0.10', { 'x-forwarded-for': '203.0.113.50' });
    expect(r).toMatchObject({
      allowed: true,
      enforced: true,
      clientIp: '203.0.113.50',
      ipFamily: 4,
    });
    expect(r.wifiSsid).toBeNull();
  });

  it('refuses an outside IP and tells it which Wi-Fi to join (SSID only)', async () => {
    const r = await status({}, '172.28.0.10', { 'x-forwarded-for': '198.51.100.9' });
    expect(r).toEqual({
      allowed: false,
      enforced: true,
      clientIp: '198.51.100.9',
      ipFamily: 4,
      wifiSsid: 'MC2026',
    });
  });

  it('ignores forged identity headers — only the trusted hop decides', async () => {
    const r = await status({}, '172.28.0.10', {
      'x-forwarded-for': '198.51.100.9',
      'cf-connecting-ip': '203.0.113.50',
      'x-real-ip': '203.0.113.50',
      'true-client-ip': '203.0.113.50',
    });
    expect(r.allowed).toBe(false);
    expect(r.clientIp).toBe('198.51.100.9');
  });

  it('ignores X-Forwarded-For sent directly by an untrusted peer', async () => {
    const r = await status({}, '198.51.100.9', { 'x-forwarded-for': '203.0.113.50' });
    expect(r).toMatchObject({ allowed: false, clientIp: '198.51.100.9' });
  });

  it('admits IPv6 clients from an IPv6 venue prefix', async () => {
    const r = await status({ venueCidrs: ['2001:db8:aa::/48'] }, '172.28.0.10', {
      'x-forwarded-for': '2001:db8:aa:7::1',
    });
    expect(r).toMatchObject({ allowed: true, ipFamily: 6 });
  });

  it('fails closed when no venue ranges are configured', async () => {
    const r = await status({ venueCidrs: [] }, '172.28.0.10', {
      'x-forwarded-for': '203.0.113.50',
    });
    expect(r.allowed).toBe(false);
  });

  it('reports the gate as not enforced when an admin switched it OFF', async () => {
    const r = await status({ accessMode: 'OFF' }, '172.28.0.10', {
      'x-forwarded-for': '198.51.100.9',
    });
    expect(r).toMatchObject({ allowed: true, enforced: false });
  });
});
