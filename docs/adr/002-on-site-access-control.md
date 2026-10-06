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
   - Caddy accepts `CF-Connecting-IP` / `X-Forwarded-For` only from the tunnel connectors' fixed addresses (172.28.0.11 and .12).
   - Caddy then *overwrites* `X-Forwarded-For` with the resolved IP.
   - Fastify's `trustProxy` is exactly Caddy's address (172.28.0.10).
4. Entry is a **static printed QR** at the entrance and booths.
5. Access modes: `IP_ALLOWLIST` (event) or `OFF` (development and tests only, shown as a loud warning in admin).

## Consequences and risks
- Visitors on 4G/5G cannot vote until they join the venue Wi-Fi. This is intentional; the access-denied screen makes it a one-step fix.
- **IPv6:** if the venue network hands out IPv6, phones will arrive with an IPv6 address, not the NAT'd IPv4. The admin "add my current IP" helper shows the detected address family, and the setup checklist requires adding the venue's IPv6 /64 prefix (or disabling IPv6 on the venue SSID).
- Someone *on* the venue Wi-Fi can still vote without being in the hall (for example, Wi-Fi range bleeding into the car park). That is accepted; the OTP-verified phone uniqueness caps the abuse at one vote per category per real SIM.
- A spoofed-header test exists from Phase 0 onward (unit and through the real Caddy).
