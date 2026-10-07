# Data flow diagrams

Where data goes, where it is stored, and where it crosses a trust boundary. Notation: rectangles are external actors, rounded boxes are processes, cylinders are stores. Dashed boxes are trust boundaries.

## 1. Level 0: context

```mermaid
flowchart LR
  VIS["Visitor<br/>(phone)"] -->|name, phone, OTP, votes| SYS(("MC2026<br/>voting system"))
  SYS -->|catalogue, confirmation, own votes| VIS
  SYS -->|one-time code| SMSG["SMS gateway"]
  TV["Hall TV"] -->|display token| SYS
  SYS -->|"results frames (SSE)"| TV
  ORG["Organiser<br/>(admin)"] -->|credentials + TOTP, settings, content, mode changes| SYS
  SYS -->|"overview, visitors (masked), exports, audit"| ORG
```

## 2. Level 1: processes and stores

```mermaid
flowchart TB
  subgraph TB1["Trust boundary 1: the internet and the venue network"]
    VIS["Visitor phone"]
    TV["TV"]
    ORG["Organiser browser"]
  end
  subgraph TB2["Trust boundary 2: the host"]
    EDGE(["P1 Edge<br/>tunnel + Caddy<br/>resolve client IP, headers"])
    P2(["P2 Access gate<br/>venue CIDR check"])
    P3(["P3 Registration + OTP<br/>issue, verify, throttle"])
    P4(["P4 Voting<br/>validate, insert once"])
    P5(["P5 Results hub<br/>coalesce, buildFrame, SSE"])
    P6(["P6 Admin<br/>auth, RBAC, settings, content, export"])
    DS1[("D1 settings")]
    DS2[("D2 visitors<br/>otp_challenges")]
    DS3[("D3 votes")]
    DS4[("D4 catalog + photos")]
    DS5[("D5 admin_users<br/>admin_sessions")]
    DS6[("D6 audit_log")]
    DS7[("D7 display_tokens")]
    RD[("Redis<br/>rate-limit counters")]
  end
  SMSG["SMS gateway"]

  VIS -->|HTTPS| EDGE
  TV -->|HTTPS| EDGE
  ORG -->|HTTPS| EDGE
  EDGE -->|"client IP (trusted hop only)"| P2
  P2 <-->|"ranges, Wi-Fi hint"| DS1
  P2 --> P3
  P2 --> P4
  P3 <-->|"encrypted name/phone, hashed code"| DS2
  P3 -->|code| SMSG
  P3 <--> RD
  P3 -->|"signed session cookie"| VIS
  P4 -->|"read eligibility"| DS4
  P4 -->|"INSERT … ON CONFLICT DO NOTHING"| DS3
  DS3 -->|"NOTIFY (tag only)"| P5
  DS1 -->|"NOTIFY on mode change"| P5
  P5 -->|"counts or sealed snapshot"| DS3
  P5 <-->|"mode, snapshot, revealed"| DS1
  P5 <-->|"token hash"| DS7
  P5 -->|"frames (SSE)"| TV
  P6 <--> DS5
  P6 <--> DS1
  P6 <--> DS4
  P6 -->|"unmask, export (consent-filtered)"| DS2
  P6 -->|"every action"| DS6
  P6 <--> DS7
  ORG --> EDGE
```

## 3. Data inventory

| Data | Entered at | Stored in | Form | Who can read it | Leaves the system? |
|---|---|---|---|---|---|
| Visitor name, phone | sign-in | D2 `visitors` | AES-256-GCM | API (to send the SMS and to unmask); SUPER_ADMIN only, with a typed reason, audited | phone goes to the SMS gateway to deliver the code |
| Phone hash | sign-in | D2 | HMAC-SHA256 + pepper | API only | no |
| One-time code | generated server-side | D2 `otp_challenges` | HMAC | nobody (only compared) | in the SMS text |
| Consent (vote, outreach, version) | sign-in | D2 | timestamps | ADMIN/SUPER_ADMIN | the outreach list exports only consenting visitors |
| Vote | vote screen | D3 | plain ids + time + client IP | aggregated for TVs; individual rows only via export (audited) | CSV export |
| Client IP | every request | D3, D2, logs | text | admins | no |
| Venue ranges, Wi-Fi name/password | console | D1 | plain | admins; the Wi-Fi name is shown to a blocked visitor | no |
| Admin password, TOTP secret, recovery codes | console / CLI | D5 | argon2id / AES-GCM / SHA-256 | API only | no |
| Photos | console | D4 | validated WebP | public by URL (they are the catalogue) | no |
| Audit entries | every admin action | D6 | jsonb, append-only | SUPER_ADMIN | no |

## 4. Flow: sign-in (registration + one-time code)

```mermaid
sequenceDiagram
  autonumber
  participant V as Visitor
  participant E as Edge (Caddy)
  participant A as API
  participant D as Postgres
  participant S as SMS gateway
  V->>E: POST /api/auth/otp/request {name, phone, consents}
  E->>A: client IP resolved from trusted hop
  A->>A: origin check · venue gate · phone normalised, prefix allowed · limits (phone, device, IP, global)
  A->>D: store challenge (encrypted name/phone, HMAC of code, expiry)
  A->>S: "your code is 123456" (adapter, timeout)
  A-->>V: challengeId (never the code, a blocked number gets a look-alike answer and no SMS)
  V->>E: POST /api/auth/otp/verify {challengeId, code}
  A->>D: attempts+1, compare HMAC (constant time), consume once
  A->>D: upsert visitor by phone_hash (identity exists only now)
  A-->>V: Set-Cookie mc_session (signed, HttpOnly, Secure, 12 h)
```

## 5. Flow: Blind Hour and reveal

```mermaid
sequenceDiagram
  autonumber
  participant O as Organiser
  participant A as API (admin)
  participant D as Postgres
  participant H as ResultsHub (every replica)
  participant T as TVs
  O->>A: POST /api/admin/results/mode {FROZEN} (typed confirmation, CSRF, MFA session)
  A->>D: lock settings row · snapshot every active category · write audit row (one transaction)
  D-->>H: NOTIFY (urgent: skips the 1 s window)
  H->>T: sealed frame (snapshot only, live counts are not read)
  Note over T: votes keep arriving in D3, no live number reaches any TV
  O->>A: POST /api/admin/results/reveal {category}
  A->>D: store that category's standings now · audit
  D-->>H: NOTIFY
  H->>T: ceremony for that category, then it stays as a final result
```

## 6. Trust boundaries and what is checked at each

| Boundary crossed | Check |
|---|---|
| Internet → host | TLS at Cloudflare; the tunnel is outbound-only (no inbound port on the venue network); Caddy accepts the client IP only from the connector's fixed address |
| Edge → API | the API trusts `X-Forwarded-For` from Caddy's address only; `CF-Connecting-IP`, `X-Real-IP`, `True-Client-IP` are never read |
| Visitor → API | origin check (CSRF), signed session, venue gate on sign-in and on **every** vote, schema validation (zod) on every body |
| TV → API | revocable display token in an `HttpOnly; SameSite=Strict` cookie scoped to `/api/display`; the stream re-checks it |
| Organiser → API | password + TOTP, DB-backed session, per-session CSRF token, role permission per route ([auth.md](auth.md)) |
| API → Postgres | least-privilege role `mc_app`; every query parameterised; constraints and triggers hold regardless |
| API → SMS gateway | outbound only, timeout, the code is generated and verified by us |
