# ADR-003: Blind Hour / Freeze Results, enforced server-side

- **Status:** Accepted, 2026-10-06

## Context
Organisers want suspense before the winner announcement. The TVs must freeze or hide standings while voting continues normally.

## Decision
- `settings.results_visibility` ∈ `LIVE | FROZEN | HIDDEN | REVEAL`, toggled by admins (with confirmation, audit-logged).
- Entering `FROZEN` atomically stores `frozen_snapshot` (the standings at that instant) and `frozen_at`.
- **Enforcement is in the API, not the UI.** While the setting is not `LIVE`, every public and display channel (SSE stream, any public results endpoint) serves **only** the frozen snapshot (`FROZEN`), or no standings at all (`HIDDEN`). Live tallies never reach a TV browser, so DevTools, the network tab or a refresh can't reveal them.
- Vote ingestion is completely independent of visibility: votes are accepted, constrained and counted exactly as in `LIVE`.
- Only authenticated admins can read live counts during the Blind Hour, and each read is audit-logged.
- `REVEAL` publishes final standings category by category for the announcement.

## Consequences
- Switching modes notifies all replicas through `NOTIFY`, so every TV changes state within ≤ 1 s.
- Tests must assert that, while frozen, the SSE payload equals the frozen snapshot even after new votes arrive.

## Implementation notes (Phase 4)
Built as specified; details and the reasoning behind them are in [ADR-006](006-live-results-and-tv-displays.md). Two refinements to the decision above: `REVEAL` stores a per-category snapshot at the moment each category is announced (so a late vote cannot change an announced winner), and entering `FROZEN` snapshots **every** active category, including empty ones.

