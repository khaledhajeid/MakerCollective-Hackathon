# Load test report

**Claim tested:** 1,000 visitors can sign in with a one-time code and vote, at the same time, through the real stack, with no vote lost or duplicated, and the system keeps serving while an API replica is killed.
**Result:** all four scenarios passed. Every one of the 1,000 visitors in each run completed the journey, every vote a visitor was told was recorded exists exactly once in the database, and the TV screens ended on the database's total.
Run on 2026-10-07 against the Phase 7 build. Reproduce with `node load/run.mjs <scenario>` (see `load/README.md`); raw summaries are in `load/results/`.

## What was run
| | |
|---|---|
| Path under test | k6 → Caddy → 2 API replicas (round robin, health-checked) → Postgres 17 + Redis |
| One virtual visitor | landing page, access check, session check, catalogue, name + phone, one-time code, verify, 3 votes (one per category), my-votes check: **14 requests** |
| Visitors | 1,000 distinct phone numbers, all from **one source address** (like the venue's Wi-Fi NAT), so per-address limits are exercised |
| TV screens | 20 on the live stream for the whole run |
| Retries | like the app: a call that fails at the network or gateway is retried (2 s; votes every 6 s, same request, idempotent) |
| Stubbed | only the SMS (demo inbox read by a helper), because a test must not send real text messages |
| Machine | one laptop (10 CPU cores, 16 GB) running k6, Docker and the whole stack together; Postgres at default settings; API pool 10 connections per replica |

| Scenario | Arrival of the 1,000 visitors | Pauses between steps |
|---|---|---|
| **event** | spread over 5 minutes: the plan's worst case ("everyone within 5 min") | human pace (about 25 s per visitor) |
| **stress** | all within 30 seconds: **10× the arrival rate** | none |
| **chaos** | over 3 minutes; replica 1 killed for 40 s, restarted, waited until healthy, then replica 2 killed for 40 s | human pace |
| **chaos-overlap** (earlier run, kept) | over 2 minutes; the second replica was killed 2 s after the first was restarted (both unavailable for a few seconds) | human pace, **no** retry of failed sign-ins |

## Results
| | event | stress (10×) | chaos (kill each replica) |
|---|---|---|---|
| Visitors who completed the journey | **1,000 / 1,000** | **1,000 / 1,000** | **1,000 / 1,000** |
| Votes confirmed to visitors / in the database | 3,000 / 3,000 | 3,000 / 3,000 | 3,000 / 3,000 |
| Duplicate votes, lost votes | 0, 0 | 0, 0 | 0, 0 |
| Requests (rate) | 14,000 (44/s) | 14,000 (**467/s**) | 14,018 (67/s) |
| Failed requests (first attempt) | 0 | 0 | 1 of 14,001 application requests; it was retried and succeeded (k6 also logged 17 timeouts of the SMS stub helper, which is test scaffolding, not the system) |
| API latency p50 / p95 / p99 | 2.1 / 10 / 14 ms | 0.6 / 2.6 / 3.7 ms | 1.3 / 7.5 / 11 ms |
| Vote latency p50 / p95 / p99 | 5.8 / 10 / 14 ms | 1.3 / 2.1 / 3.7 ms | 3.4 / 7.5 / 9 ms |
| Worst single request | 51 ms | 16 ms | 3.0 s (a request that was in flight to a killed replica) |
| Peak CPU, each API replica | 19 % of one core | 28 % | 20 % |
| Peak memory, each replica / Postgres | 89 / 162 MiB | 88 / 163 MiB | 87 / 162 MiB |
| Vote → visible on a TV (commit to frame) p50 / p95 | not measured | 0.58 / 0.61 s | 0.78 / 0.93 s |

(The latencies are server-side times measured at the laptop; add the venue's network and the tunnel for what a phone feels. The stress run was faster than the event run because the machine was quieter.)

### Killing a replica
- **One failure at a time (chaos):** during the 40 s with replica 1 down there was not one failed request. Caddy's health check and retry-on-connect moved traffic to replica 2 immediately. When replica 2 was killed, one request in flight to it failed and was retried. The TV screens reconnected (30 reconnects across 20 screens, slowest 2.5 s) and ended on exactly the database's total.
- **Both replicas unavailable at once (chaos-overlap, earlier harness):** requests failed for about 10 to 20 s (Caddy waits up to 3 s for an upstream, then answers 503) until a replica passed its health check. That run did not retry failed sign-ins, so 16 visitors never got a session and their 48 votes were never sent: nothing was lost on the server (database total = confirmed total, 0 duplicates), but those visitors would have had to tap "try again". This is inherent to having two replicas and is the argument for the hotspot and the backup video in the pitch plan. I fixed the *harness* (it now retries like the app), not the system.

### TV screens
20 screens stayed connected through all runs. The frame total on every screen at the end equalled the database. "Longest gap between frames" in the raw output (about 16 s) is the idle time after the last vote: frames are sent when something changes, not on a timer. Under the stress load a vote took about 0.6 s from commit to screen (the server coalesces updates to at most one per second by design).

## NOTIFY cost (ADR-006 / Phase 4 open item)
Every vote commit emits a Postgres `NOTIFY` so replicas can push to the TVs. `NOTIFY` takes a global lock at commit, so it can cap commit throughput. Isolated benchmark (`load/notify-bench.mjs`: 50 concurrent committers, the same insert, with and without `pg_notify`, 15 s each):

| | commits per second | average latency |
|---|---|---|
| without NOTIFY | 64,400 | 0.78 ms |
| with NOTIFY | 11,000 | 4.6 ms |

So the lock is real: it removes about 83 % of the bare-insert throughput. It does not matter here: the ceiling is **about 11,000 vote commits per second**, and the stress run, 10× the plan's worst case, cast 3,000 votes in roughly 30 s (**about 100 per second**). The real vote path also does far more work per commit than this benchmark, which lowers the relative cost. The 5-second resync on the TVs means the screens stay correct even if `NOTIFY` were removed. Decision: keep it.

## Capacity reading (indicative, not a guarantee)
At 467 requests per second each replica used about a quarter of one CPU core and Postgres about 0.13 of a core (of 10), with latency still in single-digit milliseconds. This points to ample headroom over the plan's requirement on this hardware. It was not pushed to failure, so no maximum is claimed.

## What this does not show
- **The venue's network and the Cloudflare tunnel** (latency, bandwidth, drops) were not in the path; the test ran on the laptop's loopback network. The tunnel was exercised separately in earlier phases (access gate verified through the real hostname).
- **Real SMS delivery time.** The gateway's latency and any per-second limit it has are the likely real bottleneck for sign-in; the OTP code path itself answers in about 10 ms.
- **The laptop is a single point of failure** (power, sleep, Docker, Wi-Fi). Mitigations are in `docs/runbooks/event-day.md`.
- **A load generator on the same machine** competes for CPU, which makes the numbers conservative for the server.
