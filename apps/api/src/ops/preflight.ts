/**
 * Pre-event readiness check (Phase 7). `evaluate` is pure: it takes a snapshot of the configuration and the data
 * and returns what must be fixed before the doors open. `gather` (cli/preflight.ts) builds the snapshot.
 *   FAIL  the event would run unsafely or not at all: do not open.
 *   WARN  works, but somebody should look at it.
 */
export type Level = 'pass' | 'warn' | 'fail';
export interface Check {
  id: string;
  level: Level;
  title: string;
  detail: string;
}

export interface Snapshot {
  env: {
    nodeEnv: string;
    smsProvider: string;
    demoMode: boolean;
    publicOrigin: string;
  };
  settings: {
    accessMode: 'IP_ALLOWLIST' | 'OFF';
    venueCidrs: string[];
    votingState: 'OPEN' | 'CLOSED' | 'NOT_YET_OPEN';
    votingClosesAt: Date | null;
    resultsVisibility: string;
    wifiSsid: string | null;
    hasWifiPassword: boolean;
  };
  admins: {
    superAdminsReady: number; // active SUPER_ADMIN with an authenticator enrolled
    pendingSetup: number; // active accounts that have not finished first sign-in
  };
  catalog: {
    activeCategories: number;
    thinCategories: string[]; // active categories with fewer than 2 active exhibitors
    emptyCategories: string[]; // active categories with none
    exhibitorsWithoutPhoto: number;
    demoNamedExhibitors: number;
  };
  displays: { active: number };
  testData: { visitors: number; votes: number; smsOutbox: number };
  redis: 'up' | 'down' | 'disabled';
  appRole: 'ok' | 'privileged' | 'cannot-connect' | 'unchecked';
  publicHealth: 'ok' | 'unreachable' | 'skipped';
  readyzBlocked: boolean | null; // null = not checked
  analyticsBeacon: boolean | null;
}

const c = (id: string, level: Level, title: string, detail: string): Check => ({
  id,
  level,
  title,
  detail,
});

export function evaluate(s: Snapshot, now: Date = new Date()): Check[] {
  const out: Check[] = [];

  // ── configuration ──
  out.push(
    s.env.smsProvider === 'http'
      ? c('sms', 'pass', 'SMS provider', 'The real gateway (http) is configured.')
      : c(
          'sms',
          'fail',
          'SMS provider',
          `SMS_PROVIDER=${s.env.smsProvider}: one-time codes would be readable by organisers or logged. Set SMS_PROVIDER=http.`,
        ),
  );
  out.push(
    s.env.demoMode
      ? c('demo', 'fail', 'Demo mode', 'DEMO_MODE=true. Remove it from .env for the real event.')
      : c('demo', 'pass', 'Demo mode', 'Off.'),
  );
  out.push(
    s.env.nodeEnv === 'production'
      ? c('prod', 'pass', 'Environment', 'NODE_ENV=production.')
      : c(
          'prod',
          'fail',
          'Environment',
          `NODE_ENV=${s.env.nodeEnv}. Set STACK_NODE_ENV=production.`,
        ),
  );
  out.push(
    s.env.publicOrigin.startsWith('https://')
      ? c('https', 'pass', 'Public address', s.env.publicOrigin)
      : c(
          'https',
          'fail',
          'Public address',
          `${s.env.publicOrigin} is not https: session cookies would not be Secure.`,
        ),
  );
  out.push(
    s.appRole === 'ok'
      ? c('dbrole', 'pass', 'Database role', 'The API connects as the DML-only mc_app role.')
      : s.appRole === 'unchecked'
        ? c(
            'dbrole',
            'warn',
            'Database role',
            'Not checked (APP_DB_PASSWORD missing in this shell).',
          )
        : c(
            'dbrole',
            'fail',
            'Database role',
            s.appRole === 'privileged'
              ? 'The application role has owner/superuser rights.'
              : 'The mc_app role cannot sign in: run `pnpm stack:up` so the migrate step provisions it.',
          ),
  );

  // ── access control ──
  if (s.settings.accessMode === 'OFF')
    out.push(
      c(
        'gate',
        'fail',
        'Venue network check',
        'Access mode is OFF: anyone on the internet can vote.',
      ),
    );
  else if (!s.settings.venueCidrs.length)
    out.push(
      c(
        'gate',
        'fail',
        'Venue network check',
        'Allow-list is ON but has no ranges: every visitor would be refused.',
      ),
    );
  else {
    out.push(
      c('gate', 'pass', 'Venue network check', `On, ${s.settings.venueCidrs.length} range(s).`),
    );
    out.push(
      s.settings.venueCidrs.some((r) => r.includes(':'))
        ? c('ipv6', 'pass', 'IPv6 ranges', 'At least one IPv6 range is listed.')
        : c(
            'ipv6',
            'warn',
            'IPv6 ranges',
            'Only IPv4 listed. If the venue network gives phones IPv6 addresses, add its IPv6 prefix.',
          ),
    );
  }
  out.push(
    s.admins.superAdminsReady >= 2
      ? c('supers', 'pass', 'Super admins', `${s.admins.superAdminsReady} with an authenticator.`)
      : s.admins.superAdminsReady === 1
        ? c(
            'supers',
            'warn',
            'Super admins',
            'Only one super admin. If that person loses their phone nobody can unlock the console (the operator CLI still can).',
          )
        : c('supers', 'fail', 'Super admins', 'No super admin has an authenticator enrolled.'),
  );
  if (s.admins.pendingSetup)
    out.push(
      c(
        'pending',
        'warn',
        'Accounts not set up',
        `${s.admins.pendingSetup} active account(s) have not completed first sign-in (temporary passwords expire after 48 h).`,
      ),
    );

  // ── content ──
  if (!s.catalog.activeCategories)
    out.push(
      c('cats', 'fail', 'Categories', 'There are no active categories: nothing to vote on.'),
    );
  else if (s.catalog.emptyCategories.length)
    out.push(
      c('cats', 'fail', 'Categories', `No exhibitors in: ${s.catalog.emptyCategories.join(', ')}.`),
    );
  else
    out.push(
      c(
        'cats',
        s.catalog.thinCategories.length ? 'warn' : 'pass',
        'Categories',
        s.catalog.thinCategories.length
          ? `Only one exhibitor in: ${s.catalog.thinCategories.join(', ')} (a one-horse race).`
          : `${s.catalog.activeCategories} active, each with at least two exhibitors.`,
      ),
    );
  out.push(
    s.catalog.demoNamedExhibitors
      ? c(
          'demo-names',
          'fail',
          'Placeholder content',
          `${s.catalog.demoNamedExhibitors} exhibitor(s) still carry the demo names from the seed. Replace them in the console.`,
        )
      : c('demo-names', 'pass', 'Placeholder content', 'No demo exhibitor names left.'),
  );
  out.push(
    s.catalog.exhibitorsWithoutPhoto
      ? c(
          'photos',
          'warn',
          'Exhibitor photos',
          `${s.catalog.exhibitorsWithoutPhoto} active exhibitor(s) have no photo (cards fall back to a placeholder).`,
        )
      : c('photos', 'pass', 'Exhibitor photos', 'Every active exhibitor has one.'),
  );
  out.push(
    s.displays.active
      ? c('tv', 'pass', 'TV displays', `${s.displays.active} paired token(s).`)
      : c(
          'tv',
          'warn',
          'TV displays',
          'No display token exists yet (pnpm stack:display create "Main hall").',
        ),
  );
  out.push(
    s.settings.wifiSsid && s.settings.hasWifiPassword
      ? c('wifi', 'pass', 'Wi-Fi details', `Shown to blocked visitors: ${s.settings.wifiSsid}.`)
      : c(
          'wifi',
          'warn',
          'Wi-Fi details',
          'Network name or password is empty: blocked visitors are not told how to join.',
        ),
  );

  // ── event state ──
  if (s.testData.visitors || s.testData.votes)
    out.push(
      c(
        'clean',
        s.settings.votingState === 'OPEN' ? 'warn' : 'fail',
        'Test data',
        `${s.testData.visitors} visitors and ${s.testData.votes} votes already exist. Before the event: pnpm stack:reset-event.`,
      ),
    );
  else out.push(c('clean', 'pass', 'Test data', 'No visitors or votes yet.'));
  if (s.testData.smsOutbox)
    out.push(
      c(
        'outbox',
        'warn',
        'SMS inbox',
        `${s.testData.smsOutbox} stored demo message(s) (they contain one-time codes).`,
      ),
    );
  if (
    s.settings.votingState === 'CLOSED' &&
    s.settings.votingClosesAt &&
    s.settings.votingClosesAt < now
  )
    out.push(c('window', 'fail', 'Voting window', 'The scheduled window has already ended.'));
  else out.push(c('window', 'pass', 'Voting window', `Voting is ${s.settings.votingState}.`));
  out.push(
    s.settings.resultsVisibility === 'LIVE'
      ? c(
          'mode',
          'pass',
          'Results mode',
          'LIVE (switch to FROZEN for the Blind Hour in the console).',
        )
      : c(
          'mode',
          'warn',
          'Results mode',
          `${s.settings.resultsVisibility}: TVs show the sealed screen.`,
        ),
  );

  // ── runtime ──
  out.push(
    s.redis === 'up'
      ? c('redis', 'pass', 'Redis', 'Up.')
      : c(
          'redis',
          'warn',
          'Redis',
          s.redis === 'disabled'
            ? 'Not configured: rate limits are per replica only.'
            : 'Down: running degraded (limits per replica).',
        ),
  );
  if (s.publicHealth !== 'skipped')
    out.push(
      s.publicHealth === 'ok'
        ? c('public', 'pass', 'Public address reachable', 'The tunnel answers /api/healthz.')
        : c(
            'public',
            'fail',
            'Public address reachable',
            'The public hostname did not answer: check the tunnel (pnpm stack:tunnel).',
          ),
    );
  if (s.readyzBlocked !== null)
    out.push(
      s.readyzBlocked
        ? c('readyz', 'pass', 'Readiness hidden', '/api/readyz is not served through the tunnel.')
        : c(
            'readyz',
            'warn',
            'Readiness hidden',
            '/api/readyz is reachable from outside; rebuild the edge (pnpm stack:up).',
          ),
    );
  if (s.analyticsBeacon)
    out.push(
      c(
        'analytics',
        'warn',
        'Cloudflare Web Analytics',
        'Cloudflare is injecting its analytics beacon. Disable it for this hostname (it is blocked by our CSP and is third-party tracking).',
      ),
    );
  return out;
}

export const exitCode = (checks: Check[]): number =>
  checks.some((x) => x.level === 'fail') ? 1 : 0;
