# Runbook: TVs and the Blind Hour

For the organiser at the laptop. The admin console does all of this with buttons (see `admin-console.md`); these commands are the break-glass path if the console is ever unavailable and do the same thing through the same code. Run them from the project folder. They work against the running Docker stack.

## Pair a TV (once per screen)
```
pnpm stack:display create "Main hall"
```
It prints a link ending in `/live#t=…`. **It is shown only once** (only a hash is stored). Open that link in the TV's browser (full-screen, `F11`). **Use the event's public address** (the one in the link, e.g. `https://vote.alrabetahub.app/live…`): the server only accepts pairing from its configured address, so a link opened on `localhost` or a LAN IP shows "This address is not allowed to pair" (add that address to `EXTRA_ORIGINS` if you really need it). The screen pairs, removes the secret from the address bar and starts showing results. The pairing lasts 30 days on that browser.

- A TV with no link: open `https://<your-domain>/live` and type the display code into the box.
- List screens and when each was last seen: `pnpm stack:display list`
- A screen was lost, or must stop showing results now: `pnpm stack:display revoke <id>` (the TV returns to the pairing screen within about 5 seconds).
- Several TVs: create one display per screen so each can be revoked on its own.

## Run the Blind Hour
```
pnpm stack:results status            # what the TVs show right now
pnpm stack:results mode FROZEN       # seal: TVs keep the standings as of this instant
pnpm stack:results mode HIDDEN       # seal harder: TVs show no numbers at all
pnpm stack:results mode LIVE         # back to live
```
Voting is **not** affected by any of this: phones keep voting and every vote is counted. While sealed, the TVs never receive the newer numbers (not even hidden in the page), so there is nothing to find with browser tools.

Switching takes effect on every TV within about a second. A sealed result is never refreshed: `FROZEN` run twice, or `FROZEN` → `HIDDEN` → `FROZEN`, brings back the **first** snapshot. To take a fresh one, go through `LIVE` (`LIVE` then `FROZEN`).

## Announce the winners
```
pnpm stack:results mode REVEAL                  # TVs show the sealed screen, nothing released
pnpm stack:results reveal <category-slug>       # announce one category: ceremony, then it stays as a final result
```
Each reveal plays a ~15 second ceremony on every TV (winner and podium; a tie shows all co-winners). A category's standings are fixed at the moment you reveal it, so a late vote cannot change an announced winner. Announce in any order. A TV that reloads or reconnects mid-way does **not** replay old ceremonies. Category slugs are shown by `pnpm stack:results status`.

Typical evening: `mode FROZEN` at the start of the Blind Hour, close voting, `mode REVEAL`, then `reveal` once per category.

## If something looks wrong
| What you see | What it means / what to do |
|---|---|
| "Reconnecting" notice on a TV | That TV has not heard from the server for 12 seconds. The last numbers stay on screen. It recovers by itself; if not, check the TV's network, then reload the page (it stays paired). |
| TV shows the pairing screen | It was revoked, or its browser data was cleared. Create or re-open a pairing link. |
| TV shows "waiting for the first vote" | No votes yet in LIVE mode. Expected before voting starts. |
| TVs show the sealed screen unexpectedly | `pnpm stack:results status`; if the mode is `HIDDEN`/`REVEAL`, set `LIVE`. |
| Numbers on TVs lag by a few seconds | Normal during a rush: updates are batched to at most once per second. They catch up by themselves. |
| One API container restarts | TVs reconnect on their own within a couple of seconds and get a full, current screen. |

Every mode change and reveal is recorded in the audit log with who did it (`cli:operator` from the command line).
