# Event-day runbook

For the organiser at the laptop. Commands are run from the repository root. Everything here is safe to rehearse, except step 6 of "Before the doors open", which deletes rehearsal data.

## The night before
1. `.env` holds the **real** settings: `STACK_NODE_ENV=production`, `STACK_PUBLIC_ORIGIN=https://vote.makercollective.app`, `SMS_PROVIDER=http` with `SMS_HTTP_URL` / `SMS_HTTP_BODY_TEMPLATE` (and `SMS_HTTP_AUTH_HEADER`) for the organisers' gateway, `DEMO_MODE=false` (or absent), `CLOUDFLARE_TUNNEL_TOKEN`, `APP_DB_PASSWORD`.
2. Rebuild everything from the committed code: `pnpm stack:up`, then `pnpm stack:tunnel`.
3. Organiser accounts (see `admin-accounts.md`): at least **two** SUPER_ADMINs, each signed in once, authenticator enrolled, recovery codes saved somewhere other than the laptop.
4. In the console: real category names, exhibitors and photos; venue Wi-Fi name and password; the venue's public IP ranges (IPv4, and IPv6 if the venue network hands out IPv6; see "Finding the venue's address").
5. TV tokens: `pnpm stack:display create "Main hall"` for each screen; open the printed link on that TV once.
6. In Cloudflare: turn **Web Analytics off** for the hostname (it injects a script our security policy blocks anyway).

## Before the doors open (about 10 minutes)
1. Power: laptop on mains, sleep disabled, phone hotspot ready as the backup network.
2. `pnpm stack:preflight`: every line must be ok or an understood WARN. A FAIL means do not open. Typical fixes are in the line itself.
3. From a **phone on the venue Wi-Fi** open `https://vote.makercollective.app/api/access/status`: it must say you are inside. From mobile data it must say you are outside.
4. Send one real sign-in to your own number; confirm the code arrives and voting works end to end. Then, in the console, block that visitor or just leave it for step 6.
5. Set the voting window (or leave it manual) and the results mode you want at the start (LIVE).
6. **Delete rehearsal data:** `pnpm stack:reset-event` first shows how many visitors and votes exist and changes nothing. Then run the command it prints (`--confirm=DELETE-ALL-VOTES --expect-votes=<that number>`), then `docker exec mc2026-redis-1 redis-cli flushall`. It keeps organisers, settings, content, photos and TV links, and refuses if voting is open or the number no longer matches (so an old command from your shell history cannot erase a real event).
7. `pnpm stack:preflight` once more: "Test data" must read "No visitors or votes yet".

## During the event
| Situation | What to do |
|---|---|
| One API replica dies | Nothing: Caddy stops using it within seconds, visitors' retries succeed. Bring it back with `docker start mc2026-api1-1` (or `-api2-`). |
| Everything is slow | `docker stats --no-stream`. If Postgres is pegged, it is the laptop: close other apps. |
| The tunnel drops | `pnpm stack:tunnel`. TVs and phones reconnect by themselves. Fall back to the phone hotspot if the venue network is the problem. |
| SMS codes do not arrive | Check the gateway first. Visitors can resend after 60 s. The OTP counters protect the gateway from abuse, they do not block legitimate use. |
| An organiser lost their phone | Another SUPER_ADMIN resets their credentials in the console (Organisers), or the operator runs `pnpm stack:admin reset <name>`. |
| Someone is cheating / spamming | Console → Visitors: block (their votes stay, they cannot add more) or sign out. |
| Blind Hour | Console → Overview → Results: FROZEN (or HIDDEN). Reveal one category at a time with REVEAL, or LIVE to open everything. |
| Laptop restarted | Docker Desktop, then `pnpm stack:up` and `pnpm stack:tunnel`. No data is lost: it all lives in the Postgres volume. |

## Finding the venue's address
Join the venue Wi-Fi on a phone, open the console's Settings → Venue network → **Find my address**, and add the range it suggests. Do this on the venue network itself: a cafe's address is not the venue's. If the venue router uses carrier-grade NAT the address can change; the preflight will not see that, the phone test in step 3 will.

## Optional: limit the console to the organisers
The console is reachable from the internet behind passwords, authenticators, a lock-out and the audit log (risk R-A2, accepted). To close it entirely without changing code, add a Cloudflare rule: *Zero Trust → Access → Applications* (or a WAF custom rule) that only allows your own IP addresses or email domain on the paths `/admin*` and `/api/admin*`. Voters and TVs use other paths and are unaffected. Test by signing in from your phone on mobile data before relying on it.

## After the event
Export results from the console (Export → Results), switch the stack off (`pnpm stack:down`), and restore `minimumReleaseAge` to 10080 in `pnpm-workspace.yaml`.
