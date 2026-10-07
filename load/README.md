# Load tests (k6)

Evidence for "1,000 visitors at once, nothing lost". Everything goes through the real stack: Caddy → two API replicas → Postgres + Redis. Only the SMS is stubbed (the demo inbox), because a test must not send real text messages.

## One command

```
node load/run.mjs smoke            # 50 visitors, 20 s, to check the harness
node load/run.mjs event            # 1,000 visitors arriving over 5 minutes at human pace (the plan's worst case)
node load/run.mjs stress           # 1,000 visitors in 30 s with no pauses (10× the arrival rate)
node load/run.mjs event --chaos    # as `event`, and each API replica is killed for 40 s in turn
```

Each run writes `load/results/<name>/`: `summary.json` (k6), `tv.json` (what the 20 simulated TV screens saw), `stats.ndjson` (container CPU / memory every 5 s), `timeline.json` (when replicas were killed), `verify.json` (database check), plus raw points (git-ignored).

## What a run does

1. Creates a throw-away database `mc_load` (your real data is never touched), starts the stack on it with the demo SMS inbox, seeds the demo catalogue, creates 20 TV tokens.
2. Starts `otp-feed.mjs` (lets k6 read the one-time code the demo inbox "sent") and `tv-probe.mjs` (20 TVs on the live stream).
3. Runs `voter-flow.js` in the official k6 Docker image on the stack's network. One virtual visitor = landing page, access check, catalogue, name + phone, one-time code, sign-in, three votes, confirmation. A vote that fails on the network or at the gateway is retried unchanged every 6 s, like the app.
4. `verify.mjs` checks the database: every vote a visitor was told was recorded exists exactly once, nobody has two votes in a category, totals add up.
5. Puts the real stack back.

The tunnel (`vote.alrabetahub.app`) serves whatever database the stack is on, so do not run this while real visitors could arrive. Requires Docker only; k6 is pulled as `grafana/k6`.

## Reading the results honestly

- k6 and the stack share this laptop's CPU, so the numbers are conservative for the server and ignore the venue's Wi-Fi and the tunnel's latency.
- All 1,000 visitors share one source address, as they do behind the venue's NAT, so the per-address limits are exercised for real.
- `node load/notify-bench.mjs` measures what the live-results NOTIFY costs when many votes commit at once (pgbench, isolated).
