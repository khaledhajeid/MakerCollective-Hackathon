# Phase 6 review: Admin management and the console

- **Date:** 2026-10-07
- **Scope:** category and exhibitor management with photo upload, event settings, voting switch, Blind Hour and reveal control, audited live-count read, TV displays, masked visitor list with block / sign-out / unmask / OTP-throttle clear, CSV export, demo SMS inbox, the whole organiser console (sign-in, authenticator set-up, recovery codes, password change, ten screens), migration 0009, ADR-008, threat model, ASVS, runbook.
- **Verdict:** ✅ Built, tested (API integration, web unit, mutation checks), and exercised end to end **in a real browser against the real two-replica stack**: first sign-in with authenticator set-up, a cropped photo upload that reaches the voters' catalog, Blind Hour with the audited live read, reveal, display pairing and revocation, export download, audit trail. No open Critical/High from my own review. The `/code-review` and `/security-review` rounds are yours to run (§9, §10 are placeholders until then).

## 1. Plan acceptance criteria

| Criterion (plan §6, Phase 6) | Result |
|---|---|
| Every setting changes behaviour live | ✅ Voting switch, schedule, venue ranges and Wi-Fi hint are visible on the voters' endpoints within the same request on the writing replica and within the 2 s settings cache elsewhere (integration: voting status and `/api/access/status` flip right after the save). Catalog edits reach voters and TVs (the Phase 4 triggers). |
| Export matches DB counts | ✅ Results CSV vote total equals `count(votes)`; vote ledger rows equal votes; outreach rows equal opted-in, non-blocked visitors (integration). |
| Category / exhibitor CRUD + photo upload | ✅ with the rules in ADR-008 §4 (hide, never delete, once votes exist). |
| Formula-injection-safe CSV | ✅ unit table + end-to-end hostile names; mutations caught. |
| Masked visitor list | ✅ names `L••• H•••`, phones `+962 7•• ••• 567`; a test fails if a real name or number appears anywhere in the list payload. |
| Blind Hour toggle with an audit-logged admin read of live counts | ✅ ADR-008 §3. |
| Admin console, laptop-first and usable on a phone | ✅ ten screens at 1360 px and 390 px; axe (WCAG 2.2 AA tags) reports **0 violations** on all of them at both sizes. |

## 2. Automated checks

| Check | Result |
|---|---|
| `pnpm check` (typecheck, lint, format, all tests) | ✅ API **320** tests (281 before; +39 for Phase 6), web **46** (+3), shared 2 |
| Real browser, real stack (Playwright against Caddy → 2 replicas → Postgres) | ✅ sign-in → authenticator → recovery codes → password change; category and exhibitor created; **photo cropped in the browser, uploaded, served `image/webp` immutable, visible in the voter catalog**; Blind Hour confirm → audited live read → Reveal (typed word) → Live; display created (QR + link shown once) and revoked; CSV downloaded; audit entries present; **0 console errors** |
| axe-core, WCAG 2.2 A/AA, 10 screens × laptop and phone | ✅ 0 violations (after fixing 3: a `dl` with a stray `p`, a 4.2:1 badge colour, a scroll region that could not take focus) |
| Voter bundle | ✅ unchanged (admin and its 30 KB gzipped of code are a lazy chunk; `@mc/shared/manage` is a separate entry so its schemas never reach the voter) |

## 3. Self-review: defects found by testing, fixed before this gate

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | Integration test | **Blocking a visitor did not end their sessions reliably**: revocation used the database clock, session issue times use the app clock; a session issued in the next second survived | Revocation stamped with the app clock, as the visitor's own logout does (auth/service.ts). A 3-run flake is what exposed it. |
| 2 | Integration test | Vote counts in the visitor list and the outreach export were always 0: drizzle renders `${visitors.id}` unqualified inside a sub-select, so it resolved to `votes.id` | Explicit `"visitors"."id"`; the list test now asserts counts |
| 3 | **Real browser** | The photo validator **refused every photo a browser produces**: Chrome writes its sRGB profile (an `ICCP` chunk) into canvas WebPs, and I had refused ICC along with EXIF | ICC allowed only in its place (right after the header, flagged, ≤ 8 KB); EXIF, XMP, animation and unknown chunks stay refused; 4 new cases pin the boundary. The unit-style tests could not have found this: the fixtures were mine, not a browser's. |
| 4 | Real browser | Toasts rendered "Category added." with the full stop on the wrong side (the toast host sat outside the console's `dir="ltr"`) | `dir`/`lang` on the host |
| 5 | Lint | Nested `<form>` (a confirmation inside the exhibitor form would have submitted the outer form on Enter) and several effect-driven `setState`s | Confirmations sit outside the form; state resets by remounting dialog bodies |
| 6 | Mutation check | Per-phone OTP counter reset and the "exhibitor already has votes in a category" message were not pinned | Two assertions added |

## 4. Security review (STRIDE + ASVS)
Threat model: new "Phase 6" section (13 rows, residuals R-C1 to R-C3). ASVS: V5 file handling closed; V8 table references ADR-008. Highlights: server-side structural photo validation (ADR-008 §2); CSV neutralisation; the Blind Hour holds inside the console (audited per-exhibitor read, a test that the overview carries none); unmask is SUPER_ADMIN + reason + audit + auto-hide; every route passes the Phase 5 five-caller sweep (it picked up all ~30 new routes with no change).

## 5. Mutation check (does the suite catch a broken guarantee?)
21 mutants of the new code, run against the Phase 6 suite. **18 killed**, 3 survive and are protected by a second layer (documented, not hidden):

| Survivor | Why it is equivalent |
|---|---|
| Photo: ignore trailing bytes | The RIFF-size check and the "unknown chunk" refusal reject the same files first; the explicit end check only matters for an odd-size chunk with a missing pad byte |
| Category delete without the vote pre-check | The database (composite FK `RESTRICT`) refuses the same delete and the API maps it to the same sentence |
| Overview "leak" mutant | The response schema strips unknown keys, so the mutant could not reach the wire |

Killed include: EXIF/ICC/unknown-chunk rules, CSV guard and phone rule, ADMIN gaining unmask or the SMS inbox, block not revoking, no version check, no audit on live read, audit flooding, outreach including blocked, vote ledger leaking ids, unmask without audit, throttle not reset, unmasked names, Wi-Fi password in audit.

## 6. Accepted / open items

| Item | Severity | Plan |
|---|---|---|
| Console organisers can read live counts during the Blind Hour (audited, warned) | Low-Medium | R-C1: by design |
| ADMIN can export, including the outreach contact list | Low-Medium | R-C2: owner decision; consent filter + audit |
| Demo SMS inbox shows OTPs to SUPER_ADMINs | Low | Pre-event checklist: `SMS_PROVIDER=http` |
| Category order uses up/down buttons, not drag-and-drop | Low | Accepted (accessible, fewer failure modes) |
| No automated browser (Playwright) test of the console in CI yet; the real-browser run is a script I ran by hand | Low | The script exists in my scratch space; I can turn it into `apps/web/e2e/admin.spec.ts` in Phase 7 if you want it in the repo |
| Console is English only | Info | Owner decision; Arabic is entered in Arabic fields |
| Phase 5 backlog (R-A2 admin reachable from the internet, R-1…R-6) | see Phase 5 review | Phase 7 |
| Pre-event: delete throw-away accounts (`livecheck`, `second.admin` are disabled; `e2e.tester` disabled by me) | Low | done / see below |

## 7. Decisions needed from you
1. **Phase 7 scope on admin exposure (R-A2):** restrict `/admin` and `/api/admin` to the venue network at the event, or keep them reachable from anywhere behind MFA. My recommendation: decide after you see the load-test results; it is a one-setting change.
2. **Do you want the console's browser test kept in the repo** (Playwright, needs a seeded admin and an authenticator secret in CI)? Recommended yes, small.

## 8. Test map
- `apps/api/test/integration/admin-manage.test.ts` (39): categories (4), exhibitors (4), photos (4), settings (5), results control and overview (4), displays (1), visitors (4), export (6), SMS inbox and role split (3), plus the existing RBAC sweep over the new routes.
- `apps/web/src/surfaces/admin/time.test.ts` (3): Jordan time conversion.
- Browser run and axe: scripts in the session scratch space (not committed).

## 9. `/code-review` round (10 findings: all addressed)

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 | A wrong MFA code, recovery code or password (a 401) was treated as "session ended", bouncing the organiser back to sign-in without the message | The console remembers which endpoint failed. Sign-in steps ask the server who is signed in (typo: stay and show the message; expired half-signed-in session: back to the start); every other 401 ends the session | Real browser: wrong code keeps the screen and the message; deleting the cookie then clicking returns to sign-in |
| 2 | `invalidateQueries(['admin'])` also refreshed the session query, and a failed refresh replaced the whole console with "cannot reach the server" | Session query has its own key; the full-page error is shown only when there is no session data at all | typecheck + browser |
| 3 | **`results` export and the vote ledger gave the standings to any ADMIN during the Blind Hour** (bypassing ADR-003) | Both answer 409 unless the results are LIVE (contact list unaffected); the Export screen explains and disables them; ADR-008, threat model and runbook updated | Integration: FROZEN, HIDDEN and REVEAL refuse, Live allows, 4 audited downloads |
| 4 | `PATCH` category with `{}` reached drizzle's empty `.set()` and returned 500 | Empty edits are a 400 (schema refine) and the service guards it | Integration |
| 5 | Visitor "Show more" could skip rows: the cursor went through a millisecond JS Date, Postgres keeps microseconds | The cursor is formatted by Postgres with microseconds and compared as `timestamptz` | Integration: five visitors inside one millisecond are paged one at a time in order |
| 6 | Text typed in an address box but not added (no Enter) was silently left out of Save, with "Everything is saved" shown | Leaving the box adds it; Save is disabled and the footer says "press Add" while text is pending | Real browser: typed address is kept and saved |
| 7 | Blob URL revoked at once after `click()` on a detached link (can cancel the download; recovery codes are shown once) | One `saveFile` helper: link attached while clicked, address kept for a minute | typecheck + browser (download event) |
| 8 | Sign-out and session expiry left the audit log, SMS inbox (with OTPs) and user list in the browser cache for the next person | One `endSession` wipes every cached answer and the CSRF token, used by all three paths (a first version used `clear()` and would have hidden the sign-in screen: caught in the browser) | Real browser: no audit text on the page after sign-out |
| 9 | Preview blob URL and decoded `ImageBitmap` of every photo kept alive | Released on replace / close | typecheck |
| 10 | ICC chunk rules looser than documented (after `ALPH`, or promised but absent) | ICC must come before alpha data, once, and a header that flags a profile must carry it | Integration: 3 new refusal cases |

## 10. `/security-review` round (run on the final code, after §9's fixes)
**Result: no findings at or above the reporting bar (confidence ≥ 8 of 10).** Examined: the photo parser and the public photo route (bounds, padding, trailing bytes, ICC placement, content type, `nosniff`, key format, parameterised lookup); every new route's access declaration and the ADMIN / SUPER_ADMIN split; mass-assignment through strict schemas; every raw `sql` fragment (cursor, slug `LIKE`, aggregates); the Blind Hour through the overview, exports and live read; CSV neutralisation and the download filename; the venue-CIDR path and its cache; PII in the visitor list, unmask, logs and audit; the pairing link; and the React console (no `dangerouslySetInnerHTML`, CSRF token in memory, cache wiped at sign-out).

Notes from the reviewer, judged below the bar and handled as follows:
| Note | Handling |
|---|---|
| A cursor with the right shape but a non-UUID id would reach the database and answer 500 | Fixed: the cursor must be a real UUID (400 otherwise); one test case added |
| `hasVotes` booleans and 409 messages reveal that an exhibitor has *at least one* vote | Accepted: no count or ranking; needed to explain why delete is refused |
| ADMIN can widen or switch off the venue gate, or return the TVs to Live | By design (`settings.manage`, `results.control`): audited, and the Overview warns |
| An organiser can store opaque bytes (≤ 350 KB) inside a structurally valid WebP | Served as `image/webp` with `nosniff` and CSP `default-src 'none'`: cannot execute (threat model row 1) |
