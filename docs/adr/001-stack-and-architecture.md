# ADR-001: Stack & stateless architecture

- **Status:** Accepted, 2026-10-06
- **Context:** A 2-day hackathon build that must support 1,000 users, have "no single point of failure that pauses voting", use stateless code, and deploy locally or in the cloud without special hardware. The demo runs on a laptop behind a tunnel.

## Decision
- **TypeScript end to end** in a pnpm monorepo (`apps/api`, `apps/web`, `packages/shared`). Shared Zod schemas and error codes remove front/back drift.
- **API:** Fastify 5, stateless. Replicas hold **no correctness-relevant memory**.
  - Voter sessions are signed cookies.
  - Admin sessions and OTP challenges live in Postgres.
  - Uploads go to a shared volume (laptop) or S3 (cloud) behind a `StorageProvider` interface.
- **PostgreSQL 17** is the single source of truth and the only hard dependency.
  - Integrity is enforced by the database: `UNIQUE(visitor_id, category_id)` and a composite FK to `exhibitor_categories`.
  - Fan-out to dashboards uses `LISTEN/NOTIFY`.
- **Redis 7** is an *accelerator* (shared rate-limit counters). The client fails fast (no offline queue). `/readyz` reports `degraded` but keeps the replica in rotation, and limits fall back to in-process memory.
- **Caddy** load-balances ≥ 2 API replicas with active health checks, serves the SPA, and sets the SPA's CSP.
- **SSE, not WebSockets,** for the TV dashboard: the stream is one-way, reconnects automatically, and works through proxies.
- **Docker Compose** packages everything; the database and Redis bind to loopback only.
- Dependencies are pinned exactly, and pnpm `minimumReleaseAge` is kept on: we pin an older vetted version rather than excluding fresh releases from the guard.

## Consequences
- Horizontal scaling means adding replicas. Postgres HA (managed service with a standby) is a production deployment concern, documented in `deployment.md`.
- Verified in Phase 0:
  - Round-robin across 2 replicas (5/5 split).
  - Killing a replica under traffic produced **0 failed requests (60/60 × 200)**.
