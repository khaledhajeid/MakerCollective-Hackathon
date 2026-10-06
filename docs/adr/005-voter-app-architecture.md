# ADR-005: Voter app architecture (lean entry, micro-router, own i18n, motion)

- **Status:** Accepted (Phase 3, 2026-10-06)
- **Context:** The voter surface must open fast on a mid-range phone over a congested venue network (plan §2.2: voter JS < 150 KB gzipped, Lighthouse ≥ 90 / ≥ 95), be Arabic-first with flawless RTL, and feel like a native app (press-scale buttons, transitions, a rewarding success moment). The Phase 0 skeleton put React Router, TanStack Query and every surface into one entry chunk: **106.5 KB gzipped before any voter code**, leaving nothing for motion or screens.

## Decisions

| # | Decision | Why | Cost / trade-off |
|---|---|---|---|
| 1 | **Surface dispatcher.** `main.tsx` picks a code-split entry by path: voters load `surfaces/vote/mount`; admin/TV load `staff-shell` (router + query cache). | Voters never download admin, TV, the router or the query cache | Two entry paths to keep in sync (small) |
| 2 | **~1 KB History-API router** (`lib/nav.ts`) instead of React Router in the voter app. Every screen is a real history entry; direction (for slide transitions) comes from a monotonic index in `history.state`. | The full router is ~30 KB gz; Android's system back button must work | No nested/data routes (not needed: 6 screens) |
| 3 | **No TanStack Query in the voter app.** A small store (`surfaces/vote/store.tsx`) holds access, voting window, session, catalog and votes; refreshes on `visibilitychange`, `online`, a 45 s status poll; keeps the last good catalog on a flaky network | ~13 KB gz saved; the data model is five reads and one write | Hand-written freshness logic (covered by E2E) |
| 4 | **Preboot.** The entry script starts the four first-screen reads (`access`, `voting`, `session`, `catalog`) in parallel with the bundle download; the store consumes them once and falls back to fetching itself | Overlaps network latency with JS download | One more tiny module; failures simply refetch |
| 5 | **Own typed AR/EN dictionary** (`i18n/dict.ts`, `Dict` derived from the English object so a missing Arabic key is a compile error) instead of i18next. CLDR plural forms via `Intl.PluralRules`; numbers isolated with Unicode LRI/PDI (`lib/bidi.ts`, `fmt`) so `79 123 4567` never reorders inside Arabic text | ~15 KB gz saved; full RTL; bidi correctness is testable | Deviates from plan §2 (i18next); simple `{placeholder}` interpolation only |
| 6 | **`motion` (Framer Motion's current package) via `LazyMotion` + `domAnimation`**, loaded as its own chunk after first paint (5.7 KB gz). `MotionConfig reducedMotion="user"` gives every animation its reduced-motion alternative (transform/layout skipped, opacity kept) | Spring press feedback, page transitions, sheet, success moment | One extra dependency; strict mode (`m.*` only) enforced |
| 7 | **Confirm sheet on a native `<dialog>`** with our own spring, backdrop and drag-to-dismiss from the handle | Focus trap, inert background, Esc and the top layer come from the browser; fewer custom a11y bugs | Drag is hand-written pointer code |
| 8 | **Western digits in both languages** (SMS code, phone, counts) | Matches the SMS, phone keypad and Jordanian UI convention; Arabic-Indic input is still accepted (`toAsciiDigits`) | — |
| 9 | **Photo-less exhibitors get a deterministic brand-pattern tile** (`MotifTile`, seeded by the exhibitor id) | Photos arrive in Phase 6; admins may also create exhibitors without one — the fallback is a designed state | — |
| 10 | **`@mc/shared` gains zod-free subpath exports** (`/digits`, `/constants`); the web app imports types only from the barrel | The barrel pulls zod into the bundle | The web Dockerfile must compile shared first (it does) |
| 11 | **Browser E2E on an isolated database** (`mc_e2e`, refused unless named `*_e2e`), real migrations + dev seed, dedicated ports, SMS to the demo outbox table | Proves the real flow without touching dev data or scraping logs | Needs Postgres (the compose stack) |

## Consequences
- Voter JS ≈ **122.7 KB gz** (React 68.5 + app 47.2 + entry 1.3 + motion 5.7) plus 8.4 KB CSS: under budget with ~27 KB headroom.
- Lighthouse mobile (production build, simulated slow 4G, 4× CPU): Performance 97, Accessibility 100, Best Practices 100; FCP 1.4 s, TBT 0, CLS 0. **LCP 2.6 s** on that deliberately harsh profile (plan target < 2 s on mid-range 4G); the delay is JS evaluation, not the network. Options if it matters later: drop `client` weight (Preact compat) or inline the first screen — not worth the risk before the event.
- Admin and TV (Phases 4–6) keep React Router + TanStack Query in `staff-shell`; nothing in this ADR constrains them.
