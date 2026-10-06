# MC2026 Digital Voting System

On-site, real-time community-awards voting for **The Maker Collective 2026** (CPF Makerspace × 42 Amman hackathon).

- **Plan and decisions:** [`PROJECT_MASTER_PLAN.md`](PROJECT_MASTER_PLAN.md), [`docs/adr/`](docs/adr)
- **Security:** [`docs/security/threat-model.md`](docs/security/threat-model.md)
- **Requirement coverage:** [`docs/traceability.md`](docs/traceability.md)

## Quick start

Requires Node ≥ 22.12, pnpm 11 and Docker.

```bash
pnpm install
node scripts/gen-env.mjs      # creates .env with fresh random secrets (never committed)

# Option A: develop with hot reload
pnpm infra:up                 # Postgres :55432 + Redis :56379 (loopback only)
pnpm dev                      # API :3000, web :5173 (proxies /api)

# Option B: production-like stack (2 API replicas behind Caddy)
pnpm stack:up                 # http://localhost:8080
```

| Surface | URL |
|---|---|
| Visitor voting (mobile) | `/vote` |
| Live TV dashboard | `/live` |
| Admin console | `/admin` |
| Health / readiness | `/api/healthz`, `/api/readyz` |

## Quality gate

```bash
pnpm check   # typecheck + lint + format + tests
```
