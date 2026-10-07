# Q&A sheet

Short, honest answers with the evidence to point at. Rule: **answer in two sentences, then offer the proof.** If the honest answer is "not done", say it and say what mitigates it; judges reward clear thinking about limits. Questions are grouped by the scoring criteria.

## Problem and fit

**Why not a Google Form / a paper ballot / a ready-made voting product?**
A form cannot restrict votes to the room, cannot stop one person voting repeatedly (an SMS-verified phone does), has no live board, and has no Blind Hour. The event's real constraints are a shared venue network, phones on 4G, Arabic speakers, TV glare and a pitch-room demo, and each shaped a feature.

**How did you handle Arabic?**
Arabic-first, right-to-left layout, English one tap away, the TV board bilingual and right-to-left, phone-number entry accepting Arabic digits and several formats. Categories and exhibitors carry both languages.

**What if the venue Wi-Fi has IPv6?**
Both IPv4 and IPv6 ranges are supported (`cidr[]`); the console's "Find my address" reads the address from a phone on the venue Wi-Fi. The IPv6 branch is unit-tested; checking it on a real IPv6 phone is a day-of step in the runbook.

## Access control and anti-fraud (the tiebreaker)

**How do you make sure people are physically at the event?**
The server only accepts the vote from the venue Wi-Fi's public address range, checked at code request, code verify and on every single vote. We rejected GPS (client-asserted and forgeable, and unreliable in Jordan) and a rotating on-screen QR (forces people to walk to a screen); the reasoning and tests are in ADR-002.

**Can't someone fake the IP with a header?**
No. Only the tunnel connector may tell our edge the client address, the header is read right to left, and the edge overwrites it. Forged `X-Forwarded-For`, `X-Real-IP` and `True-Client-IP` were tested through the real public hostname and ignored; with the gate on and no ranges set it refuses everyone.

**What about a VPN?**
A VPN exit address is not in the venue's range, so it is refused. The only way in is the venue network itself.

**Someone sits outside on the venue Wi-Fi and votes.**
Accepted and stated in ADR-002. The one-SIM-one-voter rule caps the damage at one vote per category per real phone.

**Someone with several SIM cards?**
Honest limit: an SMS code proves possession of a phone number, not identity, so a person with N SIMs can cast N sets of votes. It is a real cost per extra vote, they must also be on the venue network, and an organiser can block a visitor from the console. Identity checks (national ID) were out of scope and would add friction for a public event.

**Bots, scripts, SMS pumping?**
A bot must be on the venue network, then needs a working phone number and code. Limits apply per phone (5/hour), per device, per address and globally (4,000 codes/hour caps SMS cost). A CAPTCHA was not added: it hurts the visitor experience and the venue gate plus OTP already remove remote automation. A WAF rule is the next layer.

**Can the same person vote twice in a category?**
No: `UNIQUE(visitor_id, category_id)` in the database, and one phone number maps to one visitor by a unique keyed hash however the number is typed. Twenty parallel requests from one visitor produce one vote (tested).

**Can a vote be changed or deleted?**
No. There is no update path in the API, a trigger rejects any UPDATE (even from a privileged connection), and the application's database role has no UPDATE/DELETE on votes at all.

**Can an organiser tamper with results?**
An admin can only do what their role allows, behind a password and an authenticator code. Every mode change, reveal, export and unmask is written to an append-only audit log that the API cannot edit. An admin cannot edit votes. A database administrator with full control could, which is true of any system; that is why the production design uses managed Postgres with separate credentials.

**Is the ballot secret?**
It is pseudonymous, not anonymous. A vote is tied to a random visitor id so we can enforce one vote per category; the real name and phone are encrypted, and only a SUPER_ADMIN can unmask them with a typed reason, which is audited. The exports carry no names.

## Security and privacy

**Where is personal data stored and how?**
Name and phone are AES-256-GCM encrypted; the phone is also stored as a keyed HMAC for the unique index; one-time codes are stored only as an HMAC; admin passwords are argon2id. A database dump alone reveals no names or numbers.

**How are admins protected?**
Mandatory authenticator app (TOTP) with single-use recovery codes, lock-out that doubles up to an hour, 30-minute idle and 8-hour absolute sessions, a per-session CSRF token, and role-based access that is a table walked by a test on every route.

**Is the admin console reachable from the internet?**
Yes, behind those controls (accepted risk R-A2). A Cloudflare Access rule on `/admin*` closes it with no code change; it is the first thing we would add.

**What does the law require?**
Jordan's Personal Data Protection Law (No. 24 of 2023, in force since 17 March 2024): explicit consent (ours is separate for voting and for later contact), minimisation, purpose-limited exports, security, and a retention period that the organisers must set (flagged as an open decision).

**Dependency and supply-chain risk?**
Dependencies are pinned exactly, installs use the lockfile, and the containers run read-only with no capabilities. The Docker images are rebuilt from the committed code.

**Did you test security?**
Yes: a threat model and ASVS checklist, two review rounds per phase (code and security), tests that run as the restricted database role, spoofing tests, and mutation checks on the admin tests. Findings and fixes are in `docs/reviews/`.

## Scalability and soundness

**Does it really handle 1,000 people?**
We simulated 1,000 visitors through the full journey, 3,000 votes: all completed, 3,000 votes in the database, 0 lost, 0 duplicated, p95 API latency 10 ms at the planned rate and 2.6 ms at 10× the arrival rate (467 requests/s), each replica using about a quarter of one core. Plus 20 TV screens connected throughout.

**What did you not test?**
The real venue network and tunnel, and real SMS delivery times; the load generator shared the laptop. We claim headroom, not a maximum.

**What is your single point of failure?**
For the demo, the laptop (power, network). The application layer has none that pauses voting: two replicas behind health checks, proven by killing each. Production removes the laptop: replicas in two zones, managed Postgres with a standby (deployment.md).

**Why Postgres and not Redis or a queue for votes?**
Votes need an arbiter, not speed: a unique constraint and a transaction give exactly-once without extra machinery, and 3,000 votes is trivial for Postgres (measured ~11,000 commits/s with notifications on). Redis is only used for shared rate-limit counters and the app works without it.

**Why Server-Sent Events, not WebSockets?**
The stream is one-way, SSE reconnects by itself, and passes through proxies and the tunnel unbuffered. Every connect starts with a full snapshot, so a TV that missed anything corrects itself.

**What happens if a replica dies mid-vote?**
The phone retries the same request; the vote is idempotent, so the answer is "recorded" once. Tested: 40 s with a replica down, zero failed requests; one in-flight request was retried and succeeded.

**What if the database goes down?**
Voting pauses (it is the one hard dependency) and nothing is lost; the volume persists. Production design: managed standby with automatic failover.

**Why a laptop and a tunnel?**
No cold starts, no cloud bill, a stable public HTTPS address on our own domain, and no inbound port opened on the venue network. The same images run on any cloud.

## UX and design

**How does a visitor vote, and how long does it take?**
Scan the printed QR, name and phone, code, then tap an exhibitor and confirm in each category. The finality is stated before every vote, the app works with a flaky connection (it never shows "recorded" until the server confirms), and targets are 48 px.

**How is the TV readable from the back of the hall?**
A fixed 1920×1080 artboard scaled to any screen, large type, bilingual, designed for glare; movement is limited to the leaderboard ordering and the numbers; motion respects reduced-motion.

**What if the TV is switched off or reloaded?**
It re-pairs with its saved token and gets a full current frame on connect. A lost screen is revoked from the console in about 5 seconds.

## Delivery, process and "what next"

**How was it built?**
In phases, each ending in a code review and a security review with written findings (`docs/reviews/phase-0` to `phase-8`), nine architecture decision records, and a requirements-traceability matrix tying each requirement F1–F14 to code and evidence.

**What is not done?**
- A CAPTCHA and a WAF rule on the console (decided, not built).
- `style-src 'unsafe-inline'` remains in the content security policy (scripts are still `'self'` only).
- A real IPv6 phone and the organisers' real SMS gateway are verified on the day.
- Retention policy is for the organisers to define.

**What would you do with another week?**
Cloudflare Access on the console, a standby Postgres and a second host, a CDN for the SPA, and a second round of load tests with the real SMS gateway and the real venue network.

**How does CPF take it over?**
Everything is containers and environment variables: the SMS gateway is a config block (`SMS_HTTP_*`), the venue ranges and Wi-Fi are rows edited in the console, runbooks cover the event day and admin accounts, and `stack:preflight` says whether it is safe to open.

**Test counts?**
API 361 tests (all running as the restricted database role), web 46, shared 2, plus browser end-to-end and accessibility scans, and the load harness.
