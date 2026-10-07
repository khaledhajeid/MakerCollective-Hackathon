# Phase 7 review: Hardening and evidence

- **Date:** 2026-10-07
- **Scope:** least-privilege database role, container hardening, log scrubbing, edge changes, the two event-day operator commands (`stack:preflight`, `stack:reset-event`), the k6 load harness, the 1,000-visitor load and replica-kill runs, the NOTIFY benchmark, dependency audit. ADR-009, `docs/load-test-report.md`, `docs/runbooks/event-day.md`.
- **Verdict:** ✅ Built and verified. Four load scenarios pass with every visitor completing, every confirmed vote present exactly once and no duplicates. `pnpm check` is clean (API 358 tests, web 46, shared 2). Awaiting your `/code-review` and `/security-review`, then your go for Phase 8.

## 1. Plan acceptance criteria (plan §6, Phase 7: "load report written; zero open Critical/High findings")

| Criterion | Result |
|---|---|
| k6 load test at 1,000 virtual users, full flow plus TV streams | ✅ `docs/load-test-report.md`: 1,000 visitors over 5 min (event), over 30 s (10×), 20 TV streams throughout. p95 10 ms (event), 2.6 ms (10×). 0 failed requests in both. |
| Kill-a-replica chaos run | ✅ Each replica killed for 40 s in turn: 1,000 of 1,000 completed, 3,000 votes confirmed and stored, 0 duplicates, 1 failed request of 14,001 (retried). An earlier overlapping double failure is documented too, with its limit. |
| NOTIFY cost measured (open since Phase 4) | ✅ Costs 83 % of bare-insert throughput but the ceiling is about 11,000 commits/s against about 100 votes/s at 10× load. Kept. |
| Zero open Critical/High findings | ✅ None open. Open Medium/Low items are listed in §5, each with an owner decision. |
| Final security sweep | ✅ `pnpm audit` (all and production) reports no known vulnerabilities. R-1, R-2, R-6, env scoping and log scrubbing are closed. `/security-review` is yours to run. |
| Pre-event checklist | ✅ `docs/runbooks/event-day.md` plus `pnpm stack:preflight` that checks it by machine. |
| `impeccable` polish pass | ⬜ **Not done in this phase.** The voter and console UIs were checked in the browser in Phases 3, 4 and 6 (axe clean). A polish pass now is a risk to a frozen build; I suggest only doing it on screenshots you flag. |

## 2. Automated checks
- `pnpm check`: typecheck, lint, format, **API 358 tests** (23 files; 38 new: 6 for the database role, 3 for the log scrubber, 29 for the preflight rules), web 46, shared 2. All pass.
- The **whole API integration suite now runs as the restricted role** (`mc_app_test`), so any query that needs more than the allow-list fails a test. The six tests that exercise the schema's own triggers and constraints connect as the owner on purpose.
- `pnpm audit` (all and `--prod`): no known vulnerabilities. Caddyfile validated with Caddy itself.
- Stack rebuilt (`pnpm stack:up`): migrate provisions the role; the API runs as `node` on a read-only filesystem; Caddy as uid 1000; `/api/readyz` answers 404 through the edge and 200 inside; the API container environment contains no tunnel token, no owner password.

## 3. Self-review: defects found while building, fixed before this gate
| Found by | Defect | Fix |
|---|---|---|
| Running the stack | Caddy would not start as a normal user with no capabilities: the stock binary has a file capability the container may not execute | Image ships a plain copy; port 80 allowed by a sysctl on that container only |
| Test run after the load runs | **The test suite reset the password of the real `mc_app` role** (roles are cluster-wide, the tests share the Postgres container) and the running API lost its database connection. It recovered by itself once the password was restored, but it would have been a nasty surprise | Tests use their own role `mc_app_test`; comment on why. The preflight's role check would have flagged it too |
| First load run | All sign-ins refused: my generated phone numbers fell in a range (77 3000–4999) the server's real validator rejects | The generator skips that range; the validator was right |
| Chaos run 1 | 16 visitors' sign-ins failed during an overlapping double failure and the script carried on without a session | Harness retries like the app; the overlap run is kept and explained rather than hidden |
| Chaos run 1 | Kills overlapped (replica 2 killed 2 s after replica 1 restarted) | Runner now waits for health before the next kill |
| Review of the first schema of grants | A table added later would have been silently readable/writable by the API if grants were "all tables" | Explicit allow-list rebuilt from scratch on every start; `REVOKE ALL` first (tested with a stale broad grant) |

## 4. Security review (STRIDE + ASVS)
Threat model section "Phase 7" has the table. In short:
- **Reduced:** SQL injection or a stolen `DATABASE_URL` can no longer disable the vote/audit triggers, rewrite or delete votes, truncate tables or read server files (8 attacks asserted as SQLSTATE 42501). A compromised API container holds no tunnel token and no owner password, has no writable disk, no capabilities and cannot gain privileges. Dependency status is not readable from outside. Failed queries no longer put session hashes, phone hashes or names in the logs.
- **Operations:** the two commands that matter on the day exist and are tested (rules as a pure function with a table test).
- **ASVS:** V9, V12, V13, V15 moved to ✅ with evidence.

## 5. Accepted / open items
| Item | Severity | Disposition |
|---|---|---|
| R-A2 `/admin` and `/api/admin` reachable from the internet | Medium | **Your decision.** Protected by passwords, mandatory authenticator, lock-out, per-address limits, audit. A Cloudflare Access / WAF rule closes it with no code change (runbook). I recommend adding that rule if you can before the event; I did not build an in-app switch (more code on the last day for the same effect). |
| R-3 CSP `style-src 'unsafe-inline'` | Low | Accepted. Scripts stay `'self'`; nonce-ing every inline style is not safe to change now. |
| R-5 the laptop is a single point of failure | Medium (event), accepted | Mains power, phone hotspot, recorded backup video. The load test shows the application layer survives a replica failure; it cannot show the laptop's. |
| Both replicas unavailable at once: requests fail for 10–20 s until one is healthy | Low | Inherent to two replicas on one host; documented in the report. |
| The API holds `SESSION_SECRET`, the PII key and the `mc_app` password | Low | Needed to work. |
| `stack:reset-event` and `stack:preflight` rely on the operator running them | Low | In the runbook as numbered steps. |
| The load generator shared the laptop with the system under test; the venue network and tunnel were not in the path | Low | Stated in the report. |
| Console Playwright spec not added (Phase 6 §6) | Low | **Your call**, see §6. The real-browser run exists as scratch scripts and the unit and integration suites cover the API. |
| Phase 5/6 items R-A1, R-C1..R-C3 | as before | Unchanged. R-C3 is closed by the preflight FAIL on a demo SMS provider. |

## 6. Decisions and actions for you
1. **Admin exposure (R-A2):** add the Cloudflare rule from the runbook, or accept the current protection? (Recommend adding it, testing from your phone on mobile data.)
2. **Playwright spec for the console:** worth about an hour; I'd put it in Phase 8's time only if everything else is done. Recommend: skip, keep the recorded browser run as evidence.
3. **Before the event** (also in `docs/runbooks/event-day.md`): finish your own sign-in and authenticator and create a second SUPER_ADMIN; switch `SMS_PROVIDER` to `http` with the gateway details; `STACK_NODE_ENV=production`; venue IP ranges; real categories, exhibitors, photos, Wi-Fi details; TV tokens; turn Cloudflare Web Analytics off; `pnpm stack:reset-event`, then `pnpm stack:preflight` until it has no FAIL. Today's preflight on this laptop reports the expected FAILs (still the development setup).
4. Push the commits: `git push origin main` (git stalls on the keychain for me).

## 7. Test map
`provision.test.ts` (privilege boundary), `log-scrub.test.ts`, `ops/preflight.test.ts`, existing integration suite as the restricted role, `load/` for scale and failure evidence (summaries in `load/results/`).
