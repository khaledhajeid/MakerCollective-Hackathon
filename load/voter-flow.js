// k6 load test for MC2026: the full journey of one visitor, repeated by many virtual users at once.
//   landing → sign-in (name + phone → one-time code → verify) → hub → 3 votes → confirmation.
// Everything is the real HTTP API through Caddy. Only the SMS is stubbed (demo inbox, read via otp-feed.mjs).
// The SPA's own behaviour is mirrored: a vote that fails on the network or at the gateway (502/503/504) is
// retried unchanged every 6 s; the server treats it idempotently.
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE || 'http://caddy:80';
const FEED = __ENV.FEED || 'http://host.docker.internal:8099';
const RUN = Number(__ENV.RUN_ID || 1); // makes phone numbers unique per run
const VUS = Number(__ENV.VUS || 1000);
const ARRIVE = Number(__ENV.ARRIVE_SEC || 300); // window in which the visitors arrive
const THINK = Number(__ENV.THINK || 1); // 1 = human pace, 0 = machine pace (stress)

export const options = {
  scenarios: {
    visitors: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: `${ARRIVE + 600}s`,
    },
  },
  thresholds: {
    // The things that must hold for the pitch claim "1,000 visitors, nothing lost".
    'http_req_duration{kind:api}': ['p(95)<800'],
    'http_req_duration{kind:vote}': ['p(95)<600'],
    flow_ok: ['rate>0.999'],
    votes_unconfirmed: ['count==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
};

const flowOk = new Rate('flow_ok');
const confirmed = new Counter('votes_confirmed');
const unconfirmed = new Counter('votes_unconfirmed');
const already = new Counter('votes_already_recorded');
const retriesAll = new Counter('retries_all');
const flowTime = new Trend('flow_duration_ms', true);
const otpWait = new Trend('otp_feed_wait_ms', true);

const ORIGIN = __ENV.ORIGIN || 'http://localhost:8080';
const hdr = { headers: { 'content-type': 'application/json', origin: ORIGIN } };
const api = (name) => ({ tags: { kind: 'api', name } });

// What the app does when a call fails at the network or gateway (replica restarting): the person (or the data
// layer) tries again a moment later. Statuses 0/502/503/504 are retried up to 5 times; every refusal by the
// application itself (4xx) is final. The first failed attempt still counts in http_req_failed.
const RETRYABLE = (r) => r.status === 0 || r.status === 502 || r.status === 503 || r.status === 504;
function send(method, url, body, params, waitSec = 2) {
  const p = { ...params, responseCallback: http.expectedStatuses(200, 404) };
  let r;
  for (let attempt = 0; attempt < 5; attempt++) {
    r = method === 'GET' ? http.get(url, p) : http.post(url, body, p);
    if (!RETRYABLE(r)) return r;
    retriesAll.add(1);
    sleep(waitSec);
  }
  return r;
}

function pause(s) {
  if (THINK) sleep(s);
}

export default function () {
  const vu = exec.vu.idInTest; // 1..VUS
  // Visitors arrive spread across the window, like people walking in.
  sleep((ARRIVE * (vu - 1)) / VUS);
  const t0 = Date.now();

  // Unique, valid Jordanian mobile per visitor. The last three digits are the VU number, so the masked form
  // ("+962 7•• ••• 123") identifies the VU for the OTP feed. The prefix varies per run.
  const suffix = String(vu % 1000).padStart(3, '0');
  // 77 + 4 digits: the server's validator rejects 77 3000–4999, so those are skipped (1000–2999, 5000–9999 are valid).
  const x = (RUN * 7919 + Math.floor(vu / 1000)) % 7000;
  const mid = String(x < 2000 ? 1000 + x : 3000 + x);
  const phone = `+96277${mid}${suffix}`;
  const masked = `+962 7•• ••• ${suffix}`;

  let ok = true;
  let catalog;

  group('landing', () => {
    send('GET', `${BASE}/`, null, { tags: { kind: 'static', name: 'index' } });
    const st = send('GET', `${BASE}/api/voting/status`, null, api('voting-status'));
    const ac = send('GET', `${BASE}/api/access/status`, null, api('access-status'));
    const se = send('GET', `${BASE}/api/auth/session`, null, api('session-anon'));
    ok = check(st, { 'status 200': (r) => r.status === 200 }) && ok;
    ok = check(ac, { 'access 200': (r) => r.status === 200 }) && ok;
    ok = check(se, { 'session 200': (r) => r.status === 200 }) && ok;
    const cat = send('GET', `${BASE}/api/catalog`, null, api('catalog'));
    ok = check(cat, { 'catalog 200': (r) => r.status === 200 }) && ok;
    if (cat.status === 200) catalog = cat.json('categories');
  });
  pause(3);

  let challengeId;
  const since = Date.now() - 2000;
  group('sign-in', () => {
    const r = send(
      'POST',
      `${BASE}/api/auth/otp/request`,
      JSON.stringify({
        name: `Load Visitor ${vu}`,
        phone,
        voteConsent: true,
        outreachConsent: false,
        locale: 'en',
      }),
      { ...hdr, tags: { kind: 'api', name: 'otp-request' } },
    );
    ok = check(r, { 'otp request 200': (x) => x.status === 200 }) && ok;
    if (r.status === 200) challengeId = r.json('challengeId');
  });
  if (!challengeId) {
    flowOk.add(false);
    return;
  }

  // The visitor waits for the SMS and types the code (the feed stands in for the phone).
  let code;
  const w0 = Date.now();
  for (let i = 0; i < 40 && !code; i++) {
    const f = http.get(`${FEED}/otp?to=${encodeURIComponent(masked)}&since=${since}`, {
      tags: { kind: 'feed', name: 'otp-feed' },
      responseCallback: http.expectedStatuses(200, 404),
    });
    if (f.status === 200) code = f.json('code');
    else sleep(0.25);
  }
  otpWait.add(Date.now() - w0);
  pause(6);
  if (!code) {
    flowOk.add(false);
    return;
  }

  group('verify', () => {
    const r = send('POST', `${BASE}/api/auth/otp/verify`, JSON.stringify({ challengeId, code }), {
      ...hdr,
      tags: { kind: 'api', name: 'otp-verify' },
    });
    ok = check(r, { 'verify 200': (x) => x.status === 200 }) && ok;
  });
  const me = send('GET', `${BASE}/api/auth/session`, null, api('session'));
  ok =
    check(me, { 'signed in': (r) => r.status === 200 && r.json('authenticated') === true }) && ok;
  send('GET', `${BASE}/api/me/votes`, null, api('my-votes'));
  pause(4);

  // Vote in every category (a different exhibitor per visitor so the standings are not degenerate).
  for (const [ci, cat] of (catalog || []).entries()) {
    const pool = cat.exhibitors;
    if (!pool || !pool.length) continue;
    const pick = pool[(vu + ci) % pool.length];
    const body = JSON.stringify({ categoryId: cat.id, exhibitorId: pick.id });
    const r = send(
      'POST',
      `${BASE}/api/votes`,
      body,
      { ...hdr, tags: { kind: 'vote', name: 'vote' } },
      6,
    );
    const done = r.status === 200;
    if (done) {
      confirmed.add(1);
      if (r.json('alreadyRecorded')) already.add(1);
    }
    if (!done) {
      unconfirmed.add(1);
      ok = false;
    }
    pause(3);
  }
  send('GET', `${BASE}/api/me/votes`, null, api('my-votes-after'));

  flowOk.add(ok);
  flowTime.add(Date.now() - t0);
}

export function handleSummary(data) {
  return { '/results/summary.json': JSON.stringify(data, null, 2) };
}
