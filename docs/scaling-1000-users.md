# Scaling to 1,000 concurrent visitors

The claim: **1,000 visitors can sign in and vote in the same few minutes, with no vote lost or duplicated, and the system keeps serving while a server dies.** This page gives the reasoning first, then the measured evidence ([`load-test-report.md`](load-test-report.md) has every number and the raw results are in `load/results/`), then what it does *not* prove.

## 1. The reasoning

### How much work is 1,000 visitors?

| Quantity | Value | Basis |
|---|---|---|
| Requests per visitor, whole journey | 14 | as counted by the load report: page and catalogue, access and session checks, code request, verify, 3 votes, my-votes |
| Total requests | ~14,000 | 1,000 × 14 |
| Worst realistic burst | ~35–45 requests/s | everyone within 5 minutes (the plan's worst case) |
| Votes | 3,000 (one per visitor per category) | each ~100 bytes |
| One-time codes | ~3.3/s on average over 5 minutes | 1,000 / 300 s |
| TV connections | a handful | scales with screens, not visitors |

This is small for a database and a Node service. The design question is therefore not raw speed but **correctness under concurrency and survival of a failure**.

### Where each part can bottleneck, and why it does not

| Part | How it scales | Limit and margin |
|---|---|---|
| **API** | stateless; add replicas behind Caddy. No sticky sessions, no in-memory correctness state | each replica used 19–28 % of one core at 10× the planned rate |
| **Vote write** | one indexed `INSERT … ON CONFLICT DO NOTHING`; uniqueness is a database constraint, so concurrent requests cannot race into duplicates | ~11,000 commits/s measured *with* the notification trigger; the event needs ~100/s at 10× load |
| **Leaderboard reads** | the TVs do not run a query per vote: one coalesced `GROUP BY` per replica per second (index-only scan on `votes (category_id, exhibitor_id)`) | cost grows with TVs × replicas, not voters; 1,000 votes in a burst cost ~1 query/s |
| **Live push** | Server-Sent Events; Postgres `NOTIFY` wakes every replica, each pushes to its own TVs; a 5 s resync repairs any missed notification | vote → screen p50 0.58 s, p95 0.61 s under the 10× run |
| **Sign-in** | OTP challenges are Postgres rows; limits are per phone (tight) and per IP (generous: the whole venue shares one NAT address) | the code path answers in ~10 ms; **the SMS gateway is the real limit** (see §4) |
| **Rate limiting** | shared counters in Redis; if Redis is down, per-replica memory; the limits are set so that 1,000 people behind one IP are never throttled | `otpRequest.perIp` 3,000 / 10 min; global SMS ceiling 4,000 / h |
| **Postgres** | one node; the single hard dependency | 3,000 votes is trivial; 162 MiB at peak; the production design adds a standby ([deployment.md](deployment.md)) |

### Designed so that scale is "add a box"

- **Sessions are signed cookies** (visitors) or Postgres rows (admins): a request can land on any replica, and a replica can vanish mid-session.
- **Writes are idempotent:** a retry of a vote returns "already recorded"; a lost response is harmless. The client retries unchanged requests on network or gateway errors (502/503/504), and shows "recorded" only after the server confirmed it.
- **Fan-out is bounded:** updates are coalesced to ≤ 1 per second per replica, and a frame is sent only if it changed.
- **Failures are contained:** Redis is optional, SMS is behind an adapter with a timeout, a TV that cannot be given a current frame is refused and reconnects rather than shown a stale one.

## 2. The evidence

All runs: k6 → Caddy → 2 API replicas → Postgres 17 + Redis, real code path, **1,000 distinct phone numbers from one source address** (like the venue NAT), **20 TV screens on the live stream**, SMS stubbed only (a test must not send texts). Reproduce with `node load/run.mjs <scenario>`.

| | Event (5-min arrival, human pace) | Stress (1,000 in 30 s, no pauses: 10× the rate) | Chaos (each replica killed for 40 s in turn) |
|---|---|---|---|
| Visitors completing the journey | **1,000 / 1,000** | **1,000 / 1,000** | **1,000 / 1,000** |
| Votes confirmed / in the database | 3,000 / 3,000 | 3,000 / 3,000 | 3,000 / 3,000 |
| Duplicate / lost votes | **0 / 0** | **0 / 0** | **0 / 0** |
| Request rate | 44/s | **467/s** | 67/s |
| API latency p50 / p95 / p99 | 2.1 / 10 / 14 ms | 0.6 / 2.6 / 3.7 ms | 1.3 / 7.5 / 11 ms |
| Failed requests (first attempt) | 0 | 0 | 1 in 14,001 (in flight to a killed replica; retried and succeeded) |
| Peak CPU per replica | 19 % of a core | 28 % | 20 % |
| Vote → TV, p50 / p95 | n/m | 0.58 / 0.61 s | 0.78 / 0.93 s |

Reading the table:

- **The integrity check is the point.** After each run a separate script compares what visitors were told ("recorded") with the database: every confirmed vote exists exactly once, and the TVs' final total equals the database's.
- **Killing a replica costs nothing.** With replica 1 down for 40 s there was not one failed request: Caddy's health check and retry-on-connect moved traffic to replica 2. The TVs reconnected (30 reconnects across 20 screens, slowest 2.5 s) and ended on the exact total.
- **Honest worst case:** with *both* replicas unavailable at once (an earlier run killed the second 2 s after the first restarted), requests failed for about 10–20 s until one passed its health check; visitors would have had to tap "try again"; **nothing was lost or duplicated on the server.** This is inherent to a two-replica, one-host event and is the reason for the hotspot and the backup video.
- **The cost of live updates was measured, not assumed.** `NOTIFY` removes ~83 % of the bare-insert throughput in isolation (64,400 → 11,000 commits/s), which is still ~100× what the event needs; we kept it.

## 3. Chaos demo (for the pitch)

During a load run or the live demo: `docker stop mc2026-api1-1` → voting continues, no error on the phone, TVs keep updating; `docker start mc2026-api1-1` → it rejoins within a health-check interval (5 s). Shown on the console's overview and the TV. Step-by-step in [`pitch/demo-script.md`](pitch/demo-script.md).

## 4. What this does not prove, and what to watch

| Gap | Why it matters | What we did about it |
|---|---|---|
| **Real SMS delivery** was stubbed | the gateway's latency and per-second limit decide how fast 1,000 people can sign in. At a 5-minute rush the average is ~3.3 codes/s, but real arrivals are bursty | ask the gateway owner for a throughput figure of at least 10 messages/s; the limits and the 60 s resend are tuned so a slow SMS does not cause a storm of retries; rehearse with a handful of real numbers |
| **The venue network and the tunnel** were not in the load path | their latency and bandwidth are real, and a venue Wi-Fi can fail before the server does | the tunnel and venue gate were verified separately end to end; the phone hotspot is the backup network |
| **The laptop is one machine** | power, sleep, Docker, its own network | mains power, sleep disabled, hotspot, backup video; the production topology removes it ([deployment.md](deployment.md)) |
| **The load generator shared the CPU** with the stack | makes the numbers conservative | none needed |
| **No maximum is claimed** | the stress run was 10× the rate but not pushed to failure | the report states "ample headroom", not a ceiling |

## 5. If the crowd were ten times larger

1. Add API replicas (up to 5 inside the default Postgres connection budget; raise the role's limit beyond that, see [deployment.md](deployment.md)).
2. Move Postgres to a managed instance with a standby; add read-only replicas only if the console's heavy reads ever matter (the voter path does not read the leaderboard).
3. Serve the static SPA from a CDN (it already has immutable cache headers).
4. Use a high-throughput SMS gateway and, if needed, raise `OTP_GLOBAL_PER_HOUR`.
5. Re-run `load/run.mjs` with `VUS` raised; the harness is the regression test for every change above.
