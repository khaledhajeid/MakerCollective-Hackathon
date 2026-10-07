# Phase 8 review: Documentation and pitch

- **Date:** 2026-10-07
- **Scope:** `docs/architecture.md`, `erd.md`, `dfd.md`, `auth.md`, `deployment.md`, `scaling-1000-users.md`, the pitch pack (`docs/pitch/`: demo script, Q&A sheet, backup-video plan, README with the printed-QR spec and the Thursday checklist), and the traceability update. No application code changed.
- **Verdict:** ✅ Written and checked against the code. The demo script has **not been run end to end by me** (it needs your phones, the room and a TV): the dress rehearsal is the test. Awaiting your review of the documents; no `/code-review` or `/security-review` findings are expected because no code changed, but run them if you want a second pair of eyes on the claims in the Q&A sheet.

## 1. Plan acceptance criteria (plan §4, Phase 8)

| Deliverable | Result |
|---|---|
| Architecture, ERD, DFD, auth, deployment guide, scaling write-up | ✅ six documents, 12 Mermaid diagrams |
| ADRs | ✅ ADR-001 to ADR-009 already in place; the new documents link to them rather than repeat them |
| Demo script | ✅ `docs/pitch/demo-script.md`: 7 min 45 s with a cut list and a failure plan |
| Backup video | 🟨 plan and shot list written; **the recording is a team task** (needs the real phones and room) |
| Q&A sheet | ✅ `docs/pitch/qa-sheet.md`, grouped by rubric criterion, with honest "not done" answers |
| Dress rehearsal Thu 10:00–11:30, under 8 minutes | ⬜ team |

## 2. How accuracy was checked

Documentation is only worth having if it is true, so each document was written from the code, the schema and the measured results, not from the plan:

- **Schema → `erd.md`:** every table, column and constraint was read from `apps/api/src/db/schema.ts` and the integrity migrations (not from the plan's §3.4 preview, which differs: for example `votes` has no `idempotency_key` column; idempotency comes from the unique constraint).
- **Routes → `architecture.md`, `auth.md`:** the full route list was extracted from the route files; vote success is `200`, not the plan's `201`.
- **Numbers → `scaling-1000-users.md`, Q&A:** copied from `docs/load-test-report.md`; the one derived figure (about 3.3 codes per second) is labelled as derived.
- **Auth parameters → `auth.md`:** OTP lifetime/attempts/cooldown from the `settings` defaults, rate limits from `modules/auth/limits.ts`, session lifetimes from `session.ts` and `admin/sessions.ts`, lock-out from `admin/service.ts`, roles from `admin/permissions.ts`.
- **Checks run:** Prettier on all new files; every relative link and heading anchor resolves; all 12 Mermaid diagrams parse with the real Mermaid parser (in a browser).

### Defects found while writing, fixed before this gate

| Defect | Fix |
|---|---|
| Two sequence diagrams did not render: a semicolon in a message is a statement separator in Mermaid | semicolons replaced with commas |
| The ERD note listed phone formats `0079…` (not a format the app accepts) | corrected to the formats the tests cover: `+962 79…`, `00962…`, `07…`, spaces, direction marks, Arabic-Indic digits |
| Q&A claimed the console can block "a device pattern" and that new package releases are held by `minimumReleaseAge` | removed: the console blocks a visitor, and the release-age guard is currently relaxed for the build window |
| Scaling document broke down the 14 requests per visitor into a list that summed to 13 | replaced with the load report's own wording |
| Demo step 4 needed a second code for the same number, but resend is limited to once per 60 s | the script now says to wait a minute |
| The plan said "Wi-Fi name and password are shown to a blocked visitor" | only the name is public (the password is not returned by the API); the documents say so |

## 3. Things the documents state honestly (so nobody is surprised in Q&A)

- The ballot is **pseudonymous, not anonymous**: a vote is tied to a random visitor id; real identities need SUPER_ADMIN, a typed reason and leave an audit row.
- A person with several SIM cards can vote more than once (an SMS code proves a phone, not a person); they still must be on the venue network.
- No CAPTCHA; the console is internet-reachable behind MFA (R-A2) until a Cloudflare Access rule is added; `style-src 'unsafe-inline'` remains (R-3).
- The demo host is one laptop; Part B of `deployment.md` is a **design, not something that was run**.
- Real SMS delivery time, the venue network and a real IPv6 phone were not measured.

## 4. Decisions and actions for you

| # | Item | Needed by |
|---|---|---|
| 1 | Read the six documents and the pitch pack; tell me anything that is wrong or that you do not want to claim (especially the Q&A answers about SIM cards, CAPTCHA and the console exposure) | before the rehearsal |
| 2 | Set the demo `.env` for the pitch room (`SMS_PROVIDER=demo-inbox`, `DEMO_MODE=true`), then **switch it back** for any real event; `stack:preflight` will FAIL in demo mode on purpose | Thu morning |
| 3 | Record the backup video after the rehearsal passes | Thu 11:30 |
| 4 | Print and scan-test the QR (spec in `docs/pitch/README.md`) | Thu morning |
| 5 | Decide the data retention period (open decision in `deployment.md`) and R-A2 (Cloudflare Access on `/admin*`: recommended) | before handover |
| 6 | Review the whole Arabic dictionary once (deferred by you to the end) | before the event |
| 7 | Run the dress rehearsal with the stopwatch; tell me the steps that fail or overrun and I will fix the script or the code | Thu 10:00 |

## 5. Test map

No code changed, so no tests were added. The claims in the documents trace to existing tests: `provision.test.ts` (database role), the 20-way race tests (one vote), `hub.test.ts`/`frame.test.ts` (Blind Hour), the admin RBAC route walk, the spoof tests, and the load harness (`load/`).
