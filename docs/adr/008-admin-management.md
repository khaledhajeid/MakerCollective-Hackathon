# ADR-008: Admin management, photos and the console

- **Status:** Accepted, 2026-10-07 (implements plan §2.4 and phase 6; builds on ADR-007)

## Context
Phase 5 made the admin API safe to expose. Phase 6 is what organisers actually do with it on the day: edit what visitors vote on, set the schedule and the venue network, run the Blind Hour, pair the TVs, help a visitor, and export. It also has to be usable from a laptop at the hall and from a phone in a pocket, by people who are not engineers, under time pressure, with a stranger-proof audit trail.

## Decisions

### 1. Permissions (final table; supersedes the proposal in ADR-007 §6)
| Permission | Who | Covers |
|---|---|---|
| `overview.read`, `content.manage`, `settings.manage`, `results.control`, `results.live`, `displays.manage`, `visitors.read`, `visitors.manage`, `export.run` | SUPER_ADMIN, ADMIN | everything needed to run the event, incl. the masked visitor list, blocking, clearing an OTP throttle and all three exports |
| `visitors.unmask`, `sms.inbox`, `admins.*`, `audit.read` | SUPER_ADMIN | real names and numbers, the demo SMS inbox (it shows one-time codes), organiser accounts, the audit log |

*Owner decision, 2026-10-07:* **ADMIN may export**, which differs from ADR-007's proposal (export = SUPER_ADMIN). The risk is the `outreach` file (names and phones). It is limited to visitors who agreed to be contacted and are not blocked, every export is audited with its kind and row count, and unmasking a *single* visitor stays SUPER_ADMIN.

### 2. Photos: validated on the server, stored in Postgres, served from the API
- The console crops to 16:10 and encodes to WebP **in the browser** (this drops EXIF/GPS and keeps files near 100 KB). That is convenience and privacy, never the only defence: `inspectWebp` parses the RIFF container itself and accepts only a still image (`VP8 `/`VP8L`/`VP8X`+`ALPH`), plus one ≤ 8 KB ICC colour profile directly after the header (Chrome always writes one). Animation, EXIF, XMP, any unknown chunk, any size that does not add up, trailing bytes, dimensions outside 200-2400 px and files over 350 KB are refused.
- Storage is a `bytea` row in `exhibitor_photos` under a server-generated `<uuid>.webp` key (DB CHECKs on key format and size; `exhibitors.photo_key` is a foreign key). Both replicas serve every photo with no shared disk, a replaced replica loses nothing, and the backup is one dump. The public route `/api/photos/:key` answers `image/webp`, `nosniff`, `Cache-Control: public, max-age=31536000, immutable`: a new upload is a new URL, so the cache can never serve a stale photo, and a phone fetches each photo once.
- *Rejected:* `sharp` or another native image library (a native add-on and its supply chain, to re-encode what the browser already re-encodes); a shared volume (a second moving part that breaks the "kill a replica" demo); object storage (needs accounts and internet). The residual is a structurally valid WebP that targets a decoder bug in a visitor's browser; it needs an authenticated organiser, and browsers decode WebP in sandboxes.

### 3. The Blind Hour holds in the console too
Totals, rates and per-category counts are shown freely (they are not a ranking). Per-exhibitor counts exist in exactly one endpoint, `/admin/results/live`. Outside LIVE mode a read writes an audit entry (at most one per five minutes per person, so the log stays readable) and the screen says the TVs are not showing these numbers. A test asserts that no exhibitor appears anywhere in the overview payload. **The same rule covers the files:** the `results` export and the `votes` ledger (which can be tallied per exhibitor) answer 409 unless the results are LIVE; the contact list has no standings and stays available. (A code review found the first draft let ADMIN download the standings mid-Blind Hour with only a generic export entry.)

### 4. Safe by default, honest about irreversible
- Content: a category or exhibitor with votes can be **hidden, never deleted** (the database forbids it too; the API checks first so the organiser reads a sentence, not a constraint name). Removing an exhibitor from a category that holds its votes is refused the same way.
- Settings: edited as a small diff against a `version` (409 with an instruction on a stale write); venue ranges are validated by the app and then by Postgres `cidr`; the audit entry records what changed and **never** the Wi-Fi password.
- The console asks before anything hard to undo, names the action on the button, and requires a typed word for closing voting and for starting the reveal. Warnings on the Overview cover the two ways to waste the event: "no venue network is set" and "venue check is OFF".
- Visitor sessions are revoked with the **app clock**, the same clock that stamps a session's issue time. An earlier draft used the database clock; a test caught that a session issued in the following second survived the block.

### 5. The console
React in the existing staff bundle (lazy-loaded: the voter's JavaScript is untouched), English only (owner decision: the organising team; Arabic content is entered in Arabic fields with RTL), one component vocabulary (`ui.tsx`), laptop-first with a phone layout (menu drawer, 44 px targets). Sign-in is a screen per server-reported `stage` (`mfa`, `enroll`, `password`, `ready`); the CSRF token lives in memory only; a 401 anywhere returns the browser to sign-in. Screens: Overview (voting switch, Blind Hour and reveal, totals, votes per minute, signals, live counts), Categories & exhibitors (with the photo cropper), Settings (with "Find my address" for the venue range), TV displays (pairing link + QR shown once), Visitors, Export, SMS inbox, Audit log, Organisers, Account.

## Consequences
- 36 new API integration tests (317 in total), 3 web unit tests; mutation checks killed 18 of 21 mutants, the other three sit behind a second layer (the database).
- `/uploads` (Caddy file server, shared volume) is removed; photos are `/api/photos/<key>`.
- Voter-facing change: none, except that `photoUrl` now points at `/api/photos/…`.
- The console is reachable wherever `/admin` is (R-A2 in the threat model still stands: restricting it to the venue network remains a Phase 7 option).

## Later additions (2026-10-08)
- **Bulk exhibitors.** `POST /admin/exhibitors/bulk` (`content.manage`) takes up to 300 exhibitors in one request (body limit 1 MB, the rest of the API keeps 64 KB). The console reads the CSV in the browser and checks every row with the same `ExhibitorCreateSchema` the server uses, so what the preview calls *Ready* is what the server accepts; the server re-validates everything, adds all rows or none in one transaction and writes one audit entry (`exhibitor.bulk_create`, the count).
- **Audit export.** `GET /admin/audit/export` (`audit.read`, SUPER_ADMIN) returns the newest 100,000 entries oldest first as CSV through the same formula-safe writer as the other exports; the download is audited as `export.run` (`kind: audit`).
- **Removing a display.** `POST /admin/displays/:id/remove` (`displays.manage`). The application role may not `DELETE` from `display_tokens` (ADR-009), so the row gets a `removed_at` marker (migration 0010) and is revoked in the same step if it was active; lists and the CLI hide removed rows. Audited as `display.remove`.
