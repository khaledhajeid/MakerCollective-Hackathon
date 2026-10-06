import { describe, expect, it } from 'vitest';
import { compileCidrs, parseIp, rateKey } from './ip.js';

describe('parseIp', () => {
  it('collapses IPv4-mapped IPv6 so IPv4 venue ranges match dual-stack sockets', () => {
    expect(parseIp('::ffff:203.0.113.9')).toEqual({ ip: '203.0.113.9', family: 4 });
    expect(parseIp('::FFFF:cb00:7109')).toEqual({ ip: '203.0.113.9', family: 4 });
  });
  it('accepts plain IPv4/IPv6 and strips zone ids', () => {
    expect(parseIp('198.51.100.7')).toEqual({ ip: '198.51.100.7', family: 4 });
    expect(parseIp('2001:db8::1')).toEqual({ ip: '2001:db8::1', family: 6 });
    expect(parseIp('fe80::1%en0')).toEqual({ ip: 'fe80::1', family: 6 });
  });
  it('rejects junk, empty and header-injection style values', () => {
    for (const bad of [
      '',
      undefined,
      null,
      'unknown',
      '999.1.1.1',
      '1.2.3.4, 5.6.7.8',
      '1.2.3.4/24',
    ]) {
      expect(parseIp(bad as string)).toBeNull();
    }
  });
});

describe('compileCidrs', () => {
  const venue = compileCidrs(['203.0.113.0/24', '198.51.100.7/32', '2001:db8:aa::/48']);
  it('matches IPv4 and IPv6 ranges in one list', () => {
    expect(venue.has(parseIp('203.0.113.200')!)).toBe(true);
    expect(venue.has(parseIp('198.51.100.7')!)).toBe(true);
    expect(venue.has(parseIp('2001:db8:aa:1::5')!)).toBe(true);
    expect(venue.has(parseIp('::ffff:203.0.113.5')!)).toBe(true);
  });
  it('rejects addresses outside every range, including neighbours', () => {
    expect(venue.has(parseIp('203.0.114.1')!)).toBe(false);
    expect(venue.has(parseIp('198.51.100.8')!)).toBe(false);
    expect(venue.has(parseIp('2001:db8:ab::1')!)).toBe(false);
  });
  it('an empty list matches nothing (fail closed)', () => {
    expect(compileCidrs([]).has(parseIp('203.0.113.5')!)).toBe(false);
  });
  it('accepts IPv4-mapped IPv6 notation for an IPv4 range', () => {
    const m = compileCidrs(['::ffff:10.0.0.0/104']);
    expect(m.rejected).toEqual([]);
    expect(m.has(parseIp('10.1.2.3')!)).toBe(true);
    expect(m.has(parseIp('11.0.0.1')!)).toBe(false);
  });
  it('reports malformed entries instead of silently widening the range', () => {
    const m = compileCidrs(['203.0.113.0/33', 'banana', '10.0.0.0/8/9']);
    expect(m.rejected).toHaveLength(3);
    expect(m.has(parseIp('10.1.1.1')!)).toBe(false);
  });
});

describe('rateKey', () => {
  it('keeps IPv4 per address', () => {
    expect(rateKey(parseIp('203.0.113.7')!)).toBe('203.0.113.7');
  });
  it('collapses every address in one IPv6 /64 to the same bucket', () => {
    const a = rateKey(parseIp('2001:db8:aa:7::1')!);
    expect(a).toBe('2001:db8:aa:7::/64');
    expect(rateKey(parseIp('2001:0db8:00aa:0007:abcd:1234:5678:9abc')!)).toBe(a);
    expect(rateKey(parseIp('2001:db8:aa:8::1')!)).not.toBe(a);
  });
  it('handles leading :: forms', () => {
    expect(rateKey(parseIp('::1')!)).toBe('0:0:0:0::/64');
  });
});
