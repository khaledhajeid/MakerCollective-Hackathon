# Phase 3 review: Voting core + mobile voter app

- **Date:** 2026-10-06
- **Scope:** `POST /api/votes`, `GET /api/me/votes`, `GET /api/voting/status`, shared vote contract, voting-window logic; the voter web app (7 screens + gate/closed/boot states, AR/EN, RTL, motion), ADR-005, browser E2E + accessibility suites, Dockerfile fix
- **Verdict:** ✅ Passed. No open Critical/High findings. Items needing the user are in §7.

## 1. Automated checks

| Check | Result |
|---|---|
| Typecheck / ESLint (incl. React purity rules) / Prettier | ✅ |
| Unit + integration tests (`pnpm check`) | ✅ shared 2 · web 15 · API **152** (23 new: voting window 4, vote API 19) on real Postgres |
| Browser E2E (Playwright, **iPhone 14 · Arabic** and **360 px Android · English**) | ✅ **28 / 28** (14 per profile): full flow, wrong code, consent, votes final, offline mid-vote, off-venue gate, voting closed, language toggle, no scroll-jump on tab return, session ended mid-vote, focus trap, axe on every screen |
| Accessibility (axe-core, WCAG 2.2 A/AA incl. contrast) on welcome, details (+errors), code, hub, category, confirm sheet, finish, gate, closed × 2 languages | ✅ 0 violations |
| Lighthouse mobile (production build) | ✅ Performance **97** · Accessibility **100** · Best Practices **100** · FCP 1.4 s · TBT 0 ms · CLS 0 · LCP 2.6 s (see ADR-005) |
| Voter JS budget (< 150 KB gz) | ✅ **122.7 KB** + 8.4 KB CSS |
| `pnpm audit` | ✅ no known vulnerabilities |
| Semgrep (typescript, react, security-audit, owasp-top-ten): 122 rules, 66 files | ✅ 0 findings |
| Live stack through the **public Cloudflare tunnel** (`vote.alrabetahub.app`) | ✅ SPA deep link 200; CSP and cache headers; gzip; unauthenticated vote → 401; cross-site POST → 403; **full browser flow (OTP → 3 votes → finish)**; stored votes carry the laptop's real public IP |

## 2. What was built
- **API:** `POST /api/votes` (order: venue gate → session → per-visitor limit → voting window → eligibility → insert), idempotent for the same choice (`alreadyRecorded`), `409 ALREADY_VOTED` for a different one, `422 EXHIBITOR_NOT_IN_CATEGORY` (wrong category, archived exhibitor, inactive category), `403 VOTING_NOT_OPEN` with the state, client IP stored in canonical form. `votingState()` is the single definition of "open" (manual OPEN/CLOSED win; SCHEDULED needs an opening time, so an unconfigured system fails closed).
- **Voter app (impeccable design process):** `PRODUCT.md` + a confirmed design brief → brand-pattern design system (rings, gear, triangles, chevron trail), press-scale buttons, direction-aware slide transitions, spring bottom sheet with a success celebration, finish screen, photo-less tile, Arabic-first RTL with bidi-safe numbers.

## 3. Self-review: issues found and fixed before this gate

| # | Finding | Severity | Outcome |
|---|---|---|---|
| S-1 | `Stage` re-ran "scroll to top + focus heading" on **every re-render**, so a catalog refresh (visitor returns from Messages) would yank them back to the top mid-scroll | High (UX, would hit most visitors) | **Fixed:** effect depends on the screen key only; regression E2E |
| S-2 | Category screen called `navigate()` during render (React warning, double navigation) | Medium | **Fixed:** effect |
| S-3 | A session ending mid-vote silently dropped the visitor on the welcome screen | Medium (confusing) | **Fixed:** explicit "your session ended" notice; E2E |
| S-4 | Offline banner was `fixed` and covered the back button / language toggle | Medium | **Fixed:** sticky in flow |
| S-5 | The code input was never focused, so iOS never offered the "From Messages" autofill | Medium (friction) | **Fixed:** `data-autofocus` honoured by the screen-change focus logic |
| S-6 | **Production Docker build failed**: the web app imports runtime helpers from `@mc/shared`, which the web Dockerfile never compiled (hidden locally because `dist` already existed) | High (deploy) | **Fixed:** Dockerfile builds shared first; stack rebuilt and verified |
| S-7 | Offline retry could spin in a tight loop if the network was "up" but the server down | Medium | **Fixed before first run:** retries are tied to the `online` event + a 6 s timer, not the `online` flag; E2E |
| S-8 | Lint (React purity): `Date.now()` in render, state set in an effect | Low | **Fixed** |
| S-10 | Phase 2 logout revocation compared the session's app-clock `iat` with a Postgres `now()` timestamp; a few ms of clock skew between the API host and the (Docker-VM) database made one test flaky and could have left a just-logged-out cookie valid | Medium (security, intermittent) | **Fixed:** revocation is stamped with the app clock, the same clock as `iat`; 37 auth tests green |
| S-9 | Initial shape: React Router + TanStack Query alone were 106.5 KB gz | High (budget) | **Fixed:** ADR-005 |

## 4. Security review (STRIDE / OWASP ASVS V3, V4, V5, V11, V14)
Full table: [`docs/security/threat-model.md`, Phase 3](../security/threat-model.md). Highlights:
- **V4 (access control):** `POST /api/votes` is gated by the venue network **and** a valid, unrevoked, unblocked session, in that order, server-side; forged cookies, logged-out/revoked sessions and blocked visitors are refused (tests).
- **Integrity (F2/F12):** one vote per visitor per category is the database's job (UNIQUE + composite FK + immutability trigger); a 20-way parallel burst of different choices yields exactly one vote.
- **Client (V5/V14):** no `dangerouslySetInnerHTML`; CSP `script-src 'self'` (Cloudflare's auto-injected analytics script is blocked, by design); category colours are DB-validated hex and set through CSSOM; PII (name/phone) lives in memory only — `sessionStorage` holds just the masked phone + challenge id.
- **Honest UI:** "recorded" is shown only after the server answers 200 (offline test asserts no false success and exactly one vote after reconnect).

## 5. Test map
- API: `votes/window.test.ts` (4), `test/integration/votes.test.ts` (19: venue gate, session/forgery/logout/blocked, closed/not-yet/unconfigured window, public status, canonical IP, idempotency, finality 409, 20-way race, ineligible exhibitor/category, validation, gate OFF).
- Web unit: phone parsing/formatting, Arabic search normalisation, contrast colour, bidi isolate, dictionary parity (same keys, same placeholders, Arabic plural forms, no empty copy).
- Browser (`apps/web/e2e`, `pnpm e2e`): `vote.spec.ts` (10 tests × 2 profiles) and `a11y.spec.ts` (4 × 2).

## 6. Accepted / open items

| Item | Severity | Decision |
|---|---|---|
| Voting window changes take up to 2 s to reach every API replica (settings cache TTL) | Low | Accepted; documented |
| LCP 2.6 s on Lighthouse's slow-4G/4×CPU profile (target 2 s) | Low | Accepted; FCP 1.4 s, TBT 0, CLS 0 (ADR-005 lists options) |
| Voter name/phone are echoed in memory only; a hard reload on the code screen loses them (resend then asks for details again) | Low | By design (no PII in storage) |
| `GET /voting/status`, `/catalog`, `/auth/session` have no per-IP limit | Low | Cheap reads; Phase 7 load test |
| Cloudflare Web Analytics beacon is injected into pages by the zone setting | Low (privacy) | CSP blocks it; **user: switch it off in the Cloudflare dashboard** |
| Dev database holds test visitors/votes from this phase | Low | Cleaned before hand-over (see §7) |

## 7. Needs the user
1. **Review the Arabic copy** (`apps/web/src/i18n/dict.ts`, `ar`). It is written natively and gender-neutral where possible, but a native speaker should read every screen once.
2. **Real photos and category names** from the teammates (photo upload arrives in Phase 6; until then the designed pattern tile shows).
3. **Cloudflare dashboard:** disable Web Analytics for `vote.alrabetahub.app`.
4. Venue IT: public IPv4 **and IPv6** prefixes (unchanged from Phase 2).
