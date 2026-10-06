# Phase 0 review: Foundation

- **Date:** 2026-10-06
- **Scope:** monorepo scaffold, API skeleton, web skeleton and brand system, Docker stack, CI
- **Verdict:** ✅ Passed. No open Critical/High findings.

## 1. Automated checks

| Check | Result |
|---|---|
| Typecheck (strict, 3 packages) | ✅ |
| ESLint | ✅ 0 problems |
| Prettier | ✅ |
| Unit tests | ✅ 10/10 |
| Production build (web) | ✅ surfaces code-split; shared entry 106 KB gz (< 150 KB budget) |
| `pnpm audit` | ✅ 0 vulnerabilities (after fix S-1) |
| gitleaks (working tree) | ✅ 3 hits, all in the local `.env` (gitignored, verified via `git check-ignore`) |
| Semgrep (owasp-top-ten, typescript, nodejs, dockerfile) | ✅ 0 code findings; 1 accepted config deviation (S-4) |

## 2. Live-stack verification (2 replicas behind Caddy)

| Test | Result |
|---|---|
| Round-robin distribution | 5 / 5 across api1 / api2 |
| Forged `CF-Connecting-IP: 6.6.6.6` + `X-Forwarded-For: 7.7.7.7` sent to Caddy | Ignored; API resolved the real peer |
| Kill api1 during 60 requests | **60 / 60 × 200** |
| Stop Redis | `/readyz` → `degraded` (200), SPA still served; automatic recovery |
| SPA security headers | CSP, HSTS, nosniff, no-referrer, Permissions-Policy present |

## 3. Code review (performance and clean code)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| C-1 | Compose made the API wait for Redis `healthy`, contradicting "Redis optional" (ADR-001) | Medium | **Fixed**: `service_started` |
| C-2 | Logs recorded the proxy socket IP, not the resolved client IP; query strings logged | Low | **Fixed**: custom `req` serializer |
| C-3 | `pino-pretty` transport would crash a production image run with `NODE_ENV=development` | Medium | **Fixed**: pretty only when stdout is a TTY |
| C-4 | Router warned about a missing `HydrateFallback` | Low | **Fixed**: branded `Splash` |
| C-5 | Brand bug: Latin text on Arabic pages rendered in Helvetica's Latin glyphs instead of Nexa | Low | **Fixed**: a single font stack (Nexa → Helvetica Neue Arabic) |
| C-6 | Host ports 5432/6379 clashed with other local projects | Low | **Fixed**: 55432/56379, loopback-bound |

## 4. Security review (STRIDE + OWASP)
The threat model was updated in `docs/security/threat-model.md` (Phase 0 table).

| # | Finding | Severity | Outcome |
|---|---|---|---|
| S-1 | GHSA-67mh-4wv8-2f99: vulnerable esbuild pulled in via drizzle-kit (dev-only) | Moderate | **Fixed**: pnpm override to 0.25.12; drizzle-kit verified working |
| S-2 | Two pinned packages published < 24 h ago (`vite@8.3.3`, `typescript-eslint@8.71.1`); pnpm auto-added guard exclusions | Medium (supply chain) | **Fixed**: pinned previous vetted versions; exclusions removed; rule "never exclude" documented |
| S-3 | GitHub Actions referenced by mutable tags (8 occurrences) | Medium | **Fixed**: pinned to commit SHAs |
| S-4 | pnpm hardening flags missing (Semgrep) | Medium | **Fixed**: `blockExoticSubdeps`, `trustPolicy: no-downgrade`, `minimumReleaseAge: 4320`. **Accepted deviation:** 3 days instead of the recommended 7 (2-day hackathon); revert to 10080 after the event |
| S-5 | `trustPolicy` blocked `semver@6.3.1` | Info | Verified false positive (npm CLI team's CVE-2022-25883 backport); exact-version exclusion with justification |
| S-6 | Further fresh releases (`@vitejs/plugin-react@6.1.2`, `pino-pretty@13.2.0`) inside the 3-day window | Low | **Fixed**: pinned 6.1.1 / 13.1.3 |

## 5. Accepted residual risks / backlog

| # | Item | Severity | Plan |
|---|---|---|---|
| R-1 | `/api/readyz` publicly reveals the Redis up/down status | Low | Phase 7: restrict to internal network or admin |
| R-2 | Caddy container runs as root (official image default) | Low | Phase 7: `user` directive with `CAP_NET_BIND_SERVICE`, or port > 1024 |
| R-3 | CSP keeps `style-src 'unsafe-inline'` (animation libraries set inline styles) | Low | Revisit in Phase 7 |
| R-4 | No rate limiting yet | Medium | Phase 2 (planned) |
| R-5 | The laptop is a single point of failure for the demo | Accepted | Mains power, backup hotspot, recorded backup video |
