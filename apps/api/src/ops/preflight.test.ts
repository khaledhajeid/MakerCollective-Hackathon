import { describe, expect, it } from 'vitest';
import { evaluate, exitCode, type Snapshot } from './preflight.js';

const good: Snapshot = {
  env: {
    nodeEnv: 'production',
    smsProvider: 'http',
    demoMode: false,
    publicOrigin: 'https://vote.example.org',
  },
  settings: {
    accessMode: 'IP_ALLOWLIST',
    venueCidrs: ['203.0.113.0/24', '2001:db8::/48'],
    votingState: 'NOT_YET_OPEN',
    votingClosesAt: null,
    resultsVisibility: 'LIVE',
    wifiSsid: 'MC2026',
    hasWifiPassword: true,
  },
  admins: { superAdminsReady: 2, pendingSetup: 0 },
  catalog: {
    activeCategories: 3,
    thinCategories: [],
    emptyCategories: [],
    exhibitorsWithoutPhoto: 0,
    demoNamedExhibitors: 0,
  },
  displays: { active: 2 },
  testData: { visitors: 0, votes: 0, smsOutbox: 0 },
  redis: 'up',
  appRole: 'ok',
  publicHealth: 'ok',
  readyzBlocked: true,
  analyticsBeacon: false,
};
const with_ = (patch: (s: Snapshot) => void): Snapshot => {
  const s = structuredClone(good);
  patch(s);
  return s;
};
const ids = (s: Snapshot, level: string) =>
  evaluate(s)
    .filter((x) => x.level === level)
    .map((x) => x.id);

describe('preflight', () => {
  it('a correctly prepared event passes cleanly', () => {
    const checks = evaluate(good);
    expect(checks.filter((x) => x.level !== 'pass')).toEqual([]);
    expect(exitCode(checks)).toBe(0);
  });

  it.each([
    ['demo SMS', (s: Snapshot) => (s.env.smsProvider = 'demo-inbox'), 'sms'],
    ['console SMS', (s: Snapshot) => (s.env.smsProvider = 'console'), 'sms'],
    ['demo mode', (s: Snapshot) => (s.env.demoMode = true), 'demo'],
    ['development build', (s: Snapshot) => (s.env.nodeEnv = 'development'), 'prod'],
    ['plain http', (s: Snapshot) => (s.env.publicOrigin = 'http://localhost:8080'), 'https'],
    ['gate off', (s: Snapshot) => (s.settings.accessMode = 'OFF'), 'gate'],
    ['gate on, no ranges', (s: Snapshot) => (s.settings.venueCidrs = []), 'gate'],
    ['no super admin ready', (s: Snapshot) => (s.admins.superAdminsReady = 0), 'supers'],
    ['no categories', (s: Snapshot) => (s.catalog.activeCategories = 0), 'cats'],
    ['empty category', (s: Snapshot) => (s.catalog.emptyCategories = ['x']), 'cats'],
    ['demo exhibitor names', (s: Snapshot) => (s.catalog.demoNamedExhibitors = 3), 'demo-names'],
    ['leftover test votes', (s: Snapshot) => (s.testData.votes = 5), 'clean'],
    ['privileged API role', (s: Snapshot) => (s.appRole = 'privileged'), 'dbrole'],
    ['role cannot sign in', (s: Snapshot) => (s.appRole = 'cannot-connect'), 'dbrole'],
    ['tunnel down', (s: Snapshot) => (s.publicHealth = 'unreachable'), 'public'],
  ])('%s is a FAIL', (_n, patch, id) => {
    expect(ids(with_(patch), 'fail')).toContain(id);
    expect(exitCode(evaluate(with_(patch)))).toBe(1);
  });

  it.each([
    ['one super admin', (s: Snapshot) => (s.admins.superAdminsReady = 1), 'supers'],
    ['IPv4 only', (s: Snapshot) => (s.settings.venueCidrs = ['203.0.113.0/24']), 'ipv6'],
    ['no photos', (s: Snapshot) => (s.catalog.exhibitorsWithoutPhoto = 2), 'photos'],
    ['one-horse category', (s: Snapshot) => (s.catalog.thinCategories = ['x']), 'cats'],
    ['no TV', (s: Snapshot) => (s.displays.active = 0), 'tv'],
    ['no wifi password', (s: Snapshot) => (s.settings.hasWifiPassword = false), 'wifi'],
    ['results sealed', (s: Snapshot) => (s.settings.resultsVisibility = 'FROZEN'), 'mode'],
    ['redis down', (s: Snapshot) => (s.redis = 'down'), 'redis'],
    ['readyz exposed', (s: Snapshot) => (s.readyzBlocked = false), 'readyz'],
    ['analytics beacon', (s: Snapshot) => (s.analyticsBeacon = true), 'analytics'],
    ['accounts not set up', (s: Snapshot) => (s.admins.pendingSetup = 1), 'pending'],
  ])('%s is a WARN, not a FAIL', (_n, patch, id) => {
    const s = with_(patch);
    expect(ids(s, 'warn')).toContain(id);
    expect(exitCode(evaluate(s))).toBe(0);
  });

  it('test data during the event is only a warning (the votes are real by then)', () => {
    const s = with_((x) => {
      x.testData.votes = 10;
      x.settings.votingState = 'OPEN';
    });
    expect(ids(s, 'warn')).toContain('clean');
  });

  it('flags a voting window that already ended', () => {
    const s = with_((x) => {
      x.settings.votingState = 'CLOSED';
      x.settings.votingClosesAt = new Date('2026-10-07T00:00:00Z');
    });
    expect(ids(s, 'fail')).toContain('window');
  });
});
