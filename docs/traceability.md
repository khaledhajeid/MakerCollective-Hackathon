# Requirements traceability

Status legend: ⬜ planned · 🟨 in progress · ✅ done (with evidence)

| ID | Requirement | Phase | Implementation | Evidence | Status |
|---|---|---|---|---|---|
| F1 | Exhibitor listing (photo, name, description, category) | 1, 3, 6 | `GET /api/catalog` (one query, Zod contract) → photo-led cards with instant AR/EN search; designed pattern tile when no photo | 5 integration tests; E2E; axe | ✅ (photo upload in Phase 6) |
| F2 | One vote per category | 1, 3 | `UNIQUE(visitor_id, category_id)` + composite FK + immutability trigger; `POST /api/votes` (idempotent, 409 on a different choice) | 9 DB + 19 API integration tests incl. 20-way races; E2E | ✅ |
| F3 | Vote confirmation + voted-categories state | 3 | confirm sheet (photo, finality wording), vote hub with ✓ state and chevron progress, finish recap, `GET /api/me/votes` | E2E (full flow, finality, offline, reload); axe | ✅ |
| F4 | Mobile-friendly, QR access | 0, 3, 8 | mobile-first SPA, 48 px targets, RTL; static QR printed in Phase 8 | Lighthouse 97 / 100 / 100; E2E on 390 px and 360 px | 🟨 (printable QR in Phase 8) |
| F5 | Name + phone, no password | 2 | `POST /api/auth/otp/request`, visitor upsert on verify | auth/OTP integration suite | ✅ |
| F6 | SMS OTP before vote accepted | 2, 3 | `AuthService` + SMS adapters (console / demo-inbox / http, ADR-004); signed visitor session; `POST /api/votes` requires the session | brute-force, replay, cooldown, expiry tests; vote-without-session 401; live flow via tunnel | ✅ |
| F7 | Live per-category leaderboard | 4 | NOTIFY → coalescer → SSE | ≤1 s latency test | ⬜ |
| F8 | Big-screen layout | 4 | live surface | 1080p screenshot | ⬜ |
| F9 | Exhibitor management + photos | 6 | admin CRUD + media | E2E | ⬜ |
| F10 | Open/close voting | 6 | settings + window check at vote time | tests | ⬜ |
| F11 | Venue IP restriction | 0, 2 | trusted-IP chain (Caddy/tunnel → Fastify) + IPv4/IPv6 CIDR gate + `GET /api/access/status` | spoof tests; **verified through the real Cloudflare tunnel** (ADR-002) | ✅ (vote gate in Phase 3) |
| F12 | Duplicate-vote prevention via OTP'd phone | 1, 2 | E.164 (+ Arabic digits) → HMAC → UNIQUE `phone_hash`; identity created only after OTP | 4 formats → 1 visitor (integration) | ✅ |
| F13 | Results export | 6 | CSV (formula-injection safe) | test | ⬜ |
| F14 | Secure visitor PII storage | 1, 2 | AES-256-GCM fields (AAD-bound), HMAC index, separate vote/outreach consent + version | crypto tests; ciphertext-at-rest and log-leak checks | ✅ |
| — | Blind Hour / Freeze (ADR-003) | 4, 6 | server-enforced `results_visibility` | frozen-payload test | ⬜ |
| NFR | Scale 1,000 users | 7 | stateless replicas, k6 | load report | ⬜ |
| NFR | No SPOF / network drops | 0, 3, 4 | 2 replicas + LB health checks; idempotent vote retries with offline queue-and-retry (no false "recorded"); SSE resume (Phase 4) | offline E2E; chaos run in Phase 7 | 🟨 |
| NFR | Portability | 0 | Docker Compose, loopback-bound data stores | `pnpm stack:up` | ✅ |
| NFR | Stateless, documented code | all | ADRs 001–005, docs/ | — | 🟨 |
| NFR | All data/settings database-driven (§6) | 1 | `settings` singleton: window, CIDRs, Wi-Fi, OTP policy, visibility, prefixes | settings tests | 🟨 |
| NFR | Privacy: admin-only PII | 1, 5, 6 | RBAC + masking + audit | tests | ⬜ |
