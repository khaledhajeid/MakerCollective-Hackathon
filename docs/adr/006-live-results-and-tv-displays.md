# ADR-006: Live results, TV displays and the Blind Hour in practice

- **Status:** Accepted, 2026-10-07 (implements ADR-003)

## Context
Phase 4 puts the standings on the hall TVs. Three things have to be true at once: votes appear within about a second, the Blind Hour (ADR-003) cannot leak even to someone reading the network tab, and the system keeps working through an API restart, a dropped Postgres connection, or a TV that reloads in the middle of a change. The venue shares one public IP and ~1,000 phones vote in a short burst, so the design must not do per-vote work per TV.

## Decisions

### 1. One function decides what a TV may see
`buildFrame(settings, catalog, live)` (`modules/results/frame.ts`) is the only place a results frame is produced.

| Mode | Source of numbers | Live counts read? |
|---|---|---|
| `LIVE` | live `GROUP BY` | yes |
| `FROZEN` | `settings.frozen_snapshot` | **no** (the `live` reader is never called) |
| `HIDDEN` | none | **no** |
| `REVEAL` | `settings.revealed[]`, one stored entry per announced category | **no** |

A missing or unparsable snapshot **fails closed** (everything sealed); it never falls back to live. Categories created after a freeze, or not yet revealed, are sealed. The frame is a single shape: sealed categories carry `sealed: true`, `total: null` and no exhibitors, so the client has nothing to hide and nothing to leak.

### 2. A frame is read in one snapshot
`ResultsService.frame()` reads the settings row, the catalog and (in LIVE) the counts inside one `REPEATABLE READ` read-only transaction. A freeze that commits mid-read can therefore never produce a frame that pairs "LIVE" with counts newer than the sealed snapshot.

### 3. State transitions are transactional, idempotent and audited
`setMode` and `revealCategory` run under `SELECT … FOR UPDATE` on the `settings` row and write an `audit_log` row in the same transaction.
- Entering `FROZEN` stores the leaderboard **for every active category, including empty ones** (an absent category would mean "created after the freeze" and render sealed). A sealed result is **never refreshed**: entering `FROZEN` again, or coming back to it from `HIDDEN` (which keeps the snapshot), restores the original. Only `LIVE` or `REVEAL` discard it, so an organiser takes a fresh snapshot by going through `LIVE`.
- Entering `REVEAL` starts with nothing released. Each `revealCategory` stores that category's standings at that moment, so a late vote cannot change an announced winner. Revealing twice is a no-op.
- The same service is used by the operator CLI now (`pnpm stack:results …`) and by the admin console in Phase 6.

### 4. Postgres announces changes; replicas coalesce
Statement-level triggers on `votes`, `settings`, the catalog tables and `display_tokens` call `pg_notify('mc_results', '<tag>')`. The payload is only a tag, never data. Putting this in the database means no write path (API, admin tool, `psql`, a future import) can forget it.

Each API replica holds one `LISTEN` connection and a `ResultsHub`:
- A vote marks the hub dirty. Recomputation is a **leading-edge throttle**: the first change recomputes at once, then at most once per second. A burst of 1,000 votes costs about one query per second per replica, not 1,000.
- A settings / catalog change (the Blind Hour toggle) is **urgent**: it skips the window. A display-token change is not a frame change: it only triggers the revocation check, and is announced only when `revoked_at` changes or a token is deleted (not by the "last seen" touch on every connect).
- A frame is broadcast only if it differs from the last one. A replica with no TV connected does no work.
- A recompute that fails (a database hiccup exactly when a freeze is announced) is retried within the throttle window, not left to the next resync; a TV that cannot be given a current frame is refused rather than served a cached one; no TV is accepted once shutdown has begun, and capacity is decided after the awaits so a reconnect burst cannot exceed it.
- Safety nets: a 5 s resync (a missed notification, or a clock-driven change such as the voting window closing), automatic reconnect of the `LISTEN` connection with jittered backoff, and a full resync after every reconnect. If `NOTIFY` ever became a commit bottleneck, the resync alone keeps the TVs correct (Phase 7 load test measures it).
- **No notification is ever lost:** an announcement that arrives while no TV is registered, or while a connecting TV's frame is being computed, still marks the hub dirty and forces another computation before that TV is served. A TV that cannot be served a *current* frame (database unreachable) is refused and reconnects, rather than being handed a cached frame that may predate a freeze. This closed a real race found in testing.

### 5. SSE, not WebSockets
Server-Sent Events: one-way, automatic browser reconnect, plain HTTP through Caddy and the Cloudflare tunnel (verified unbuffered through both). Events: `frame` (the full state, sent on connect and on every change), `time` (server clock, on connect and every 5 s, because TV clocks are unreliable and the beat doubles as a liveness signal), and `revoked`. Every connect begins with a full frame, so no event log or `Last-Event-ID` is needed, and an API restart is just a reconnect. A TV that hears nothing for 12 s tells the room it is offline (the last frame stays on screen) and reopens the stream after 25 s: a pulled cable or hung proxy never raises a browser error.

Shutdown: Fastify's `server.close()` waits for open connections and runs before `onClose` hooks, so the hub is closed in `preClose`; otherwise a restart would hang until `SIGKILL`.

### 6. TVs authenticate with a revocable display token
`mcd_` + 256 random bits; only its SHA-256 is stored. The token travels once, in a POST body (the pairing link carries it in the URL **fragment**, which the browser never sends in a request and the TV removes from the address bar immediately). It then lives in an `HttpOnly; SameSite=Strict; Secure` cookie scoped to `/api/display`. The stream re-checks the token on connect and the hub re-checks every open stream every 5 s and on every revocation notification, sending `revoked` and closing. A revoked TV drops its frame and returns to the pairing screen. Display tokens carry no PII and can only read the results frame. The venue IP gate is deliberately not applied: a TV may be on the laptop's HDMI, a wired port, or a different network, and the token is the credential.

### 7. The TV is its own lean surface
`/live` has its own entry (`surfaces/live/mount.tsx`): no router, no query cache, no motion library (reordering and ticking are CSS transitions plus a small `requestAnimationFrame` hook). It is a fixed 1920×1080 artboard scaled to any screen, always Arabic-first and right-to-left with English beside it, so there is no locale switch to mis-set. The voter bundle is unchanged (122.6 KB gz).

## Consequences
- The Blind Hour guarantee is testable in one place and was tested end to end: a browser recording of the raw event stream while 41 votes arrive during a freeze contains none of them.
- Cost scales with TVs and replicas, not with voters.
- `NOTIFY` adds a short global lock at commit for each voting transaction. At this event's scale (a few votes per second on average, bursts of tens) that is negligible, but it sits on the most important write path, so Phase 7 measures vote latency with and without it. The off-switch is one migration (drop the two `votes_notify*` triggers) plus a 500 ms resync: the TVs would be at most ~0.6 s behind instead of ~0.1 s.
- Admin viewing of live counts during the Blind Hour (read-only, audit-logged, ADR-003) arrives with admin auth in Phases 5 and 6; the service already separates "what a TV may see" from "what is true".
