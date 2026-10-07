# Phase 4 review: Live TV dashboard + Blind Hour

- **Date:** 2026-10-07
- **Scope:** results frame builder and Blind Hour state machine, `LISTEN/NOTIFY` fan-out hub, SSE stream, display-token pairing and revocation, operator CLIs, migrations 0005 and 0006, the `/live` TV surface (all modes and states), ADR-006, runbook
- **Verdict:** ✅ Built, verified end to end on the real stack, and independently design-reviewed (§5). No open Critical/High findings from my own review. **Two decisions are waiting for you (§7)**, and the user-run `/code-review` and `/security-review` rounds are still to come, as in earlier phases.

## 1. Plan acceptance criteria

| Criterion (plan §6, Phase 4) | Result |
|---|---|
| Votes on the TV ≤ 1 s | ✅ Real browser through the **public Cloudflare tunnel**, 2 replicas behind Caddy: four votes appeared in **826 ms** including the time to insert them; a later vote **927 ms**. Integration test: vote → frame via NOTIFY with the 5 s resync disabled. |
| While frozen, network inspection shows **no** live counts | ✅ Browser recording of the raw event stream while 41 votes arrived during a freeze: no new count anywhere in it. On the real stack: 30 votes during a freeze, every frame received kept the frozen total. Unit: the live-count reader is **never called** in FROZEN / HIDDEN / REVEAL. |
| Survives an API restart | ✅ Both API containers restarted one after the other with a TV open: it recovered with correct numbers and the next vote arrived in 927 ms. Integration: shutdown with TVs connected completes in < 2.5 s; a restarted replica serves them again; killing the `LISTEN` connection does not stop updates. |

## 2. Automated checks

| Check | Result |
|---|---|
| Typecheck / ESLint / Prettier | ✅ |
| Unit + integration (`pnpm check`) | ✅ shared 2 · web **43** · API **191** (new: frame builder 11, hub 7, results integration 19 on real Postgres) |
| Browser E2E (Playwright) | ✅ **45 / 45**: voter flows on iPhone 14 · Arabic and 360 px Android · English (unchanged, still green) + **13 TV specs at 1920×1080** |
| TV specs cover | pairing (wrong code, right code, address refused), link pairing and clean address bar, waiting → live → overtake, Blind Hour (frozen numbers on screen, nothing newer ever received), hidden screen has no digits, reveal ceremony then final standings and **no replay on reload**, revoke → pairing screen, 7 categories + long names + 3-way tie, **5-way tie**, silent link notice and recovery, notice over a LIVE frame, scaling to 4K / 1366×768 / 5:4, axe WCAG 2.2 AA (contrast) |
| Design detector (`impeccable detect`) | ✅ no findings |
| Bundle | ✅ voter JS unchanged at **122.6 KB gz** (budget 150); TV chunk ~41 KB gz + 0.6 KB CSS, loaded only on `/live` |
| `pnpm audit --prod` | ✅ no known vulnerabilities (one new dependency: `qrcode-generator` 2.0.4, MIT, pinned, > 1 year old) |
| Live stack (Docker, Caddy, Cloudflare) | ✅ SSE is unbuffered and uncompressed through Caddy **and** the tunnel; pairing, stream headers, freeze, restarts verified (§1) |

## 3. Self-review: defects found by testing and fixed before this gate

| # | Finding | Severity | Outcome |
|---|---|---|---|
| S-1 | **Race:** a TV connecting at the instant the mode changed (or while its first frame was computing) could keep pre-freeze numbers until the next 5 s resync: a mode-change notification was dropped when no TV was registered yet | High (breaks the Blind Hour promise for that TV) | **Fixed:** announcements are always recorded; a connecting TV recomputes until current. Deterministic unit test, mutation-checked (the test fails without the fix) |
| S-2 | A TV connecting while the database was unreachable would have been handed the cached frame, which may predate a freeze | High | **Fixed:** fails closed (refused, reconnects); mutation-checked test |
| S-3 | A TV connecting **during a vote burst** could be refused repeatedly (any notification marked the frame stale) | Medium | **Fixed:** only mode/window/catalog changes make a frame unsafe; votes just age it. Test added (found by re-reading my own hub) |
| S-4 | Freezing before a category had any votes produced a snapshot with no entry for it, so it was shown **sealed** instead of 0 (found only in the live run) | Medium | **Fixed:** the snapshot records every active category; test |
| S-5 | Server shutdown hung while TVs were connected (Fastify closes the server before `onClose` hooks) | High (restarts would hang until SIGKILL) | **Fixed:** hub closes in `preClose`; flush awaited; 8 s hard exit as a backstop |
| S-6 | My Blind Hour browser test passed even though the frozen snapshot was being rejected (timestamps with `+03:00` offsets failed validation, so the TV showed "sealed"): the **fail-closed path worked, my test was too weak** | Medium (test quality) | **Fixed:** the test now asserts the frozen numbers are on screen; helpers write ISO `Z` timestamps like the API |
| S-7 | A silently dead link (cable pulled, hung proxy) raises no browser error, so the TV would have shown stale numbers for ~35 s with no notice; and after a short silence the notice would not clear until the next vote | High (UX/trust) | **Fixed:** 5 s heartbeat, notice after 12 s, stream reopened after 25 s, any heartbeat clears the notice; tested with simulated silence |
| S-8 | The pairing token was read inside an effect; React's development double-run lost it and replaced a clear error with a silent session check | Low (dev only) | **Fixed:** read once, removed from the address bar immediately |
| S-9 | Opening the TV on `localhost` / a LAN IP fails pairing with a CSRF refusal, and the TV said "cannot reach the server" | Medium (a likely event-day mishap) | **Fixed:** the TV now says the address is not allowed; runbook explains `EXTRA_ORIGINS` |
| S-10 | Pairing rate limit (30 / 10 min / IP) could let one noisy client block a TV on the shared venue IP | Low | **Fixed:** 300 / 10 min (tokens are 256-bit; the limit only guards the database) |

## 4. Security review (STRIDE)
Full table: [`docs/security/threat-model.md`, Phase 4](../security/threat-model.md). Highlights:
- **The Blind Hour is enforced where the data is built.** One function (`buildFrame`) decides what a TV may see; outside LIVE it never loads live counts, and a corrupt or missing snapshot seals everything instead of falling back to live. The frame reads mode and counts in one `REPEATABLE READ` snapshot.
- **Display tokens:** 256-bit, stored only as a SHA-256, shown once, delivered in a URL **fragment** (never sent in a request) then an `HttpOnly; SameSite=Strict; Secure` cookie scoped to `/api/display`. Revocation closes open streams within ~5 s and returns the TV to pairing with its results removed.
- **Fan-out cost** scales with TVs and replicas, not voters (leading-edge throttle, one query per second per replica at most; broadcast only on change; capped at 200 streams per replica).
- **No PII anywhere on this path:** frames carry exhibitor names, photos and counts only; the notification payload is a tag.

## 5. Independent design review (Impeccable finish reviewer)
Reviewed against the confirmed brief and the direction contract, with screenshots of every state. First disposition **fix** (8 findings); after one fix batch the verdict pass scored:

| Finding | Outcome |
|---|---|
| Yellow reserved for the leader (pills, subtitles, offline notice used yellow) | ✅ Resolved; a follow-on regression (yellow brand tiles) was fixed afterwards |
| Rail with 5 to 8 categories lost its leaders | 🟨 **Partial → your decision (§7)**. Collapsed chips now carry colour marker + leader count |
| Rail leader line below the 56 px name floor | ✅ Rail is 144 px, leader name and count 56 px |
| Descenders clipped (غ, g, y) | ✅ |
| `flex-grow` animation (layout) | ✅ removed |
| Dwell progress stuck "full" under reduced motion | ✅ |
| Offline notice overlapped the header | ✅ moved into the header, heartbeat-driven |
| Ceremony dropped co-winners beyond 3; count far from the name | ✅ all co-winners shown; count beside the name |

The reviewer's last report still read "fix" because of the yellow-tile regression (now fixed) and the two captures it had not yet seen (collapsed counts, offline over a LIVE frame; both captured since, passing). **I did not run a third review round**: two rounds is the skill's ceiling, so the final state is verified by the screenshots and tests above rather than a third verdict.

## 6. Accepted / open items

| Item | Severity | Decision |
|---|---|---|
| No `DESIGN.md` exists for the project (voter app or TV) | Low | Offered, not done: it documents both surfaces at once; needs ~10 min and one subagent |
| `NOTIFY` takes a short global lock at commit for each voting transaction | Low | Measure in the Phase 7 load test; the 5 s resync keeps TVs correct if it ever had to be removed |
| Admin viewing live counts during the Blind Hour (audit-logged) | n/a | Arrives with admin auth (Phases 5, 6); the service already separates "what a TV may see" from "what is true" |
| Exhibitor photos not uploaded yet, so every row shows the generated brand tile | Low | Phase 6 (photo upload); layout already handles photos |
| The TV's browser history may keep the original pairing link | Low | Revoke the display if a TV is lost |
| Arabic TV copy (`tv` section of `dict.ts`) | n/a | Reviewed with the whole dictionary at the end (your instruction) |

## 7. Decisions needed from you
1. **Rail with 5 to 8 categories.** A single row cannot show a readable leader **name** for more than four categories. Today: up to 4 categories each chip shows category + leader at 56 px. With 5 or more, only the category on stage shows its leader name; the others show their colour marker and the leader's **vote count**. The event plan has 3 categories, so this only matters if you add more. Options: (a) keep it, (b) cap the TV at 4 categories and rotate the rest, (c) a two-row rail that costs two stage rows.
2. **Operations:** TVs must open the **public address** (e.g. `https://vote.alrabetahub.app/live…`) to pair. Is that how you plan to connect them? If TVs will use the laptop's local address instead, tell me and I will add it to `EXTRA_ORIGINS`.

## 8. Test map
- API unit: `modules/results/frame.test.ts` (modes, ranks, ties, fail-closed), `hub.test.ts` (lost-notification race, fail-closed, vote-burst tolerance, coalescing, change-only broadcast, capacity and slow-consumer drop, close).
- API integration (`test/integration/results.test.ts`, real Postgres + real HTTP + SSE): auth and pairing, hash-only storage, revocation, push via NOTIFY, burst coalescing, heartbeats, no PII, Blind Hour end to end, re-freeze keeps the snapshot, HIDDEN, REVEAL, audit rows, DB check, listener drop, fail-closed, shutdown and restart, connect-during-change race.
- Web unit: `surfaces/live/model.test.ts` (19: screen choice, rotation, countdown, ranking helpers, reveal trigger).
- Browser: `apps/web/e2e/live.spec.ts` (13 specs, 1080p).
- Live stack: `docs/runbooks/tv-and-blind-hour.md` describes the commands used.

## 9. `/code-review` round (10 findings)

| # | Finding | Assessment | Outcome |
|---|---|---|---|
| 1 | The `display_tokens` statement trigger notified on every UPDATE, including the "last seen" touch on every TV connect (even matching no row); the hub treated it as urgent, causing needless recomputes and feeding the stale/refuse loop | Valid, my bug | **Fixed:** migration 0007 (row-level, only when `revoked_at` changes or a token is deleted); the hub handles `display` as a revocation check only; integration test |
| 2 | FROZEN → HIDDEN → FROZEN wiped the sealed snapshot and took a new one from live votes, breaking ADR-003's "a sealed result cannot be refreshed" | Valid, **serious** | **Fixed:** HIDDEN keeps the snapshot (the DB constraint allows it); returning to FROZEN restores it; only LIVE/REVEAL discard it. Integration test; ADR-006, runbook and threat model updated |
| 3 | A failed recompute was not retried until the next 5 s resync (the dirty flag had been cleared) | Valid | **Fixed:** the failure re-arms the throttle (retry ~1 s). Unit test, mutation-checked |
| 4 | A transient failure pairing from the `#t=` link was never retried, and the token was already gone from the address bar | Valid | **Fixed:** retryable failures (network, 429, 5xx) retry with the same token every 3 s; invalid and refused-address failures stop. Browser test |
| 5 | `session` and `stream` had no rate limit; each well-formed cookie costs a lookup | Valid (DoS-class, cheap to close) | **Fixed:** 600/min/IP |
| 6 | `subscribe()` still accepted TVs after `close()`, and capacity was checked before the awaited recompute | Valid | **Fixed:** refused when closing; capacity decided after the awaits. Unit test |
| 7 | The display CLI crashed with a stack trace on a bad id | Valid | **Fixed:** friendly message and exit code |
| 8 | `NOTIFY` on every vote commit takes a global lock and could serialise vote commits | Real risk, but hypothetical at this scale (a few votes/s, bursts of tens); the vote path is the most important write path | **Accepted, with a measurement and an off-switch:** Phase 7 load test compares vote latency with and without the trigger; the switch is documented in ADR-006. Not removed now because it is the plan's architecture and the benefit (TVs ~0.1 s vs ~0.6 s behind) is real |
| 9 | The whole TV tree re-rendered every second to update one countdown and the offline notice | Valid (smart-TV browsers) | **Fixed:** the clock lives in the header only; the offline notice is a one-shot timer |
| 10 | A photo that failed once stayed "broken" for that row even after the photo URL changed | Valid | **Fixed:** the failure is remembered per URL |

Re-verified after the fixes: `pnpm check`, the full browser suite, and the live stack (below).

## 10. Decisions resolved by the owner (2026-10-07) and UI-debt round

- **Categories:** the event has 3 categories, so the rail keeps its current behaviour (full leader line up to 4 categories; marker + leader count for 5 or more). No change.
- **TV pairing address:** the public address only. TVs must open the event's public URL; localhost and LAN addresses are refused by design, with a clear message on the TV. No `EXTRA_ORIGINS` entry is added.
- **Design names** ("The Workshop Banner" and the colour names in `DESIGN.md`) approved.
- **UI debt fixed in one commit:** the Category header glass blur removed (solid canvas); every tap target is now at least 48 px (language toggle, back button, text links, search-clear); off-token colours replaced by named tokens (`faint`, `skeleton`, `dim`, `navy-dim`) or existing ones (placeholders use `muted`, which also fixes a placeholder that measured 4.0:1 against the 4.5:1 rule); default black card shadows and the desktop frame shadow made navy-tinted; Arabic initials on the no-photo tile use Bold (the Arabic face ships no Black); the Welcome triangle and QR use tokens; TV pairing placeholder raised to the dim token. Verified in a real browser (back and clear buttons measure 48 × 48), the full suite (46 browser, 195 API, 43 web tests) and the TV axe scan.
- **Left as is, on purpose:** the voter checkbox row (already a full-row 48 px target), the bottom-sheet drag handle (a drag region, not a button), the brand-artwork hex values inside the logo chevrons, and the two focus-ring colours (documented as intended).

