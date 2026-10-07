# ADR-002: On-site access = venue Wi-Fi IP allow-list + strict SMS OTP

- **Status:** Accepted, 2026-10-06 (organiser decision; supersedes the layered IP/GPS/rotating-QR proposal)

## Context
- Votes must only come from people at the venue (F11, and the rubric tiebreaker).
- Research summary (master plan §1.2):
  - Browser GPS is client-asserted and trivially forged.
  - IP geolocation only works to city level.
  - In Jordan, GPS is also unreliable because of signal jamming.
  - A rotating QR on the TVs would force visitors to walk to a screen, which is bad UX.

## Decision
1. **Venue network check (authoritative).** The venue Wi-Fi's public egress IPs/CIDRs are stored in the `settings` table and editable live by admins.
   - The check runs at **OTP request, OTP verify and vote cast**.
   - Rejected requests receive `NOT_ON_VENUE_NETWORK`, and the UI shows the Wi-Fi name and password from the database.
2. **Strict SMS OTP** (one verified phone number = one voter), see the master plan §1.1.
3. **The client IP is resolved only through trusted hops.** No client-controlled header is ever believed directly:
   - Tunnel: a **Cloudflare named tunnel** on our own domain (decision 2026-10-06), so the printed QR has a stable URL and visitors see no interstitial page. ngrok remains a fallback profile only.
   - Caddy trusts only the tunnel connectors' fixed addresses (cloudflared 172.28.0.11, ngrok 172.28.0.12), reads **only** `X-Forwarded-For`, and parses it strictly right to left. Both Cloudflare and ngrok *append* the address that connected to them (Cloudflare docs: "If an X-Forwarded-For header was already present… Cloudflare will append…"), so the right-most untrusted entry is the real client whatever the client pre-filled.
   - Caddy then *overwrites* `X-Forwarded-For` with the resolved IP.
   - Fastify's `trustProxy` is exactly Caddy's address (172.28.0.10).
   - **Never** read `CF-Connecting-IP`, `X-Real-IP` or `True-Client-IP`. On the ngrok path they pass through from the client untouched (found and fixed in the Phase 1 review, S-7). Using only XFF keeps a single, tunnel-agnostic code path. `infra/tests/ip-spoof.sh` guards against regressions; the live end-to-end check through the real tunnel was completed in Phase 2 (see below).
4. Entry is a **static printed QR** at the entrance and booths.
5. Access modes: `IP_ALLOWLIST` (event) or `OFF` (development and tests only, shown as a loud warning in admin).

## Consequences and risks
- Visitors on 4G/5G cannot vote until they join the venue Wi-Fi. This is intentional; the access-denied screen makes it a one-step fix.
- **IPv6 (more likely now that we're behind Cloudflare, whose edge is dual-stack):** a phone on a dual-stack venue Wi-Fi reaches Cloudflare over IPv6, so the address appended to `X-Forwarded-For` is IPv6, not the NAT'd IPv4. **The allow-list must contain the venue's IPv4 egress addresses *and* its IPv6 prefix (typically a /56 or /64).** `venue_cidrs` is `cidr[]`, so it accepts both. The setup checklist requires venue IT to confirm both families; the admin "detect my IP" helper (Phase 2/6) shows the detected family from a phone on the venue Wi-Fi so the right prefix gets added. If the venue has no IPv6, nothing changes.
- **Trusted hops:** Caddy trusts both tunnel connector addresses (.11, .12). Docker's dynamic pool is `172.28.0.128/25`, so those addresses can only be held by the explicitly declared connector services. Abusing them would require Docker access on the host (already full compromise). Accepted, Low.
- Someone *on* the venue Wi-Fi can still vote without being in the hall (for example, Wi-Fi range bleeding into the car park). That is accepted; the OTP-verified phone uniqueness caps the abuse at one vote per category per real SIM.
- A spoofed-header test exists from Phase 0 onward (unit and through the real Caddy).

## Verified through the real Cloudflare tunnel (Phase 2, 2026-10-06)
`GET /api/access/status` on `https://vote.makercollective.app` resolves the caller's own address through the whole chain (Cloudflare → `cloudflared` → Caddy → Fastify):

| Check | Result |
|---|---|
| Laptop's public IPv4 (`api.ipify.org`) vs `clientIp` reported by the API | identical (`176.28.158.37`) |
| `X-Forwarded-For: 203.0.113.50` (also with a two-entry forged list) | ignored, real IP reported |
| `X-Real-IP` / `True-Client-IP` forged | ignored, real IP reported |
| `CF-Connecting-IP` forged | rejected by Cloudflare itself (error 1000) |
| Gate ON with the venue range = a different network and a forged `X-Forwarded-For` inside it | refused (`allowed:false`) |
| Gate ON with the venue range = the laptop's real IP | admitted |
| Gate ON with no ranges configured | refused (fails closed) |
| Full OTP request/verify flow through the tunnel | works; cross-site POST refused (`CSRF_FAILED`) |

Dual-stack: `curl -6` from this laptop fell back to IPv4 (no IPv6 route), so the IPv6 branch was verified in unit tests (`/48` venue prefix) but **not yet on a real IPv6 phone**. Do this on-site: open `/api/access/status` from a phone on the venue Wi-Fi and add the reported prefix.
