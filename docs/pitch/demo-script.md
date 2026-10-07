# Pitch demo script (7 min 45 s, limit 8 min)

Every step below uses a feature that exists and was tested; the commands are exact. Rehearse it twice before 12:00 (dress rehearsal slot: Thu 10:00–11:30). If anything goes wrong live, say so in one calm sentence and switch to the **backup video** (see [`backup-video.md`](backup-video.md)); a recovered demo scores better than a frozen one.

## Roles

| Role | Does | Has |
|---|---|---|
| **Presenter** | talks, points at the TV, never types | clicker, the Q&A sheet |
| **Operator** | the organiser laptop: console (`/admin`) and one terminal | the laptop that hosts the stack, projected |
| **Phone A** | the live "visitor" (a teammate, or a judge's phone if offered) | one phone, a real number or a demo number |
| **Phone B** | second visitor for the Blind Hour and replica-kill steps | a second phone, a second number, **still has votes left** |

## Pitch-room setup (T-60 min)

The pitch uses the demo SMS inbox so no SMS vendor is needed; every other OTP control runs exactly as in production (ADR-004). In `.env`: `STACK_NODE_ENV=production`, `SMS_PROVIDER=demo-inbox`, `DEMO_MODE=true`, `STACK_PUBLIC_ORIGIN=https://vote.makercollective.app`. Then:

1. Laptop on mains power, sleep disabled, notifications off, Docker Desktop running, phone hotspot ready.
2. `pnpm stack:up` then `pnpm stack:tunnel`. Check `https://vote.makercollective.app/api/healthz` → 200 from a phone.
3. Reset to a clean slate: `pnpm stack:reset-event` (report first), then the command it prints. Then `docker exec mc2026-redis-1 redis-cli flushall`.
4. Console: the three real categories, exhibitors and photos are in; voting is **OPEN**; results mode **LIVE**; venue network **empty** (we add the room live in step 1; this is part of the demo). Note the Wi-Fi name and password are set in Settings.
5. TV (or a second monitor) paired and full-screen on `/live` (`pnpm stack:display create "Pitch room"`, open the link once, F11).
6. Console tab open on **Overview**; a second tab on **SMS inbox**; a terminal with `docker stop mc2026-api1-1` typed but not run. Browser DevTools ready on the TV tab (Network → filter `stream`).
7. Phone A and Phone B: on **mobile data** (Wi-Fi off) at the start; the room Wi-Fi saved and ready to join; browser cache clear; each has a number you control.
8. Record the current count of visitors and votes (Overview) so you know it is clean.

## The run

| Time | Say (Presenter) | Do | Proof the audience sees |
|---|---|---|---|
| **0:00–0:40** | "A thousand visitors, three votes each, one afternoon. The risks are fake votes, a crowd that crashes the system, and results that leak or get rewritten. We built for those three." | — | Title / architecture slide |
| **0:40–1:30** | "Votes must come from people in the room. The organiser tells the system which network is the venue's: one button." | **Operator:** Console → Settings → Venue network → **Find my address** → add the range → Save | the range appears; Overview warning "no venue network is set" disappears |
| **1:30–2:10** | "A phone on 4G, outside the room." | **Phone A (mobile data):** open `vote.makercollective.app` → sign-in | Friendly "join the venue Wi-Fi" screen with the network name from the database. No vote possible. |
| **2:10–3:40** | "Same phone, on the room Wi-Fi. Name, number, a code by SMS. We generate and check the code ourselves, so any SMS gateway works. For today the SMS lands in this inbox." | **Phone A:** join Wi-Fi → name + number + consent → request code. **Operator:** SMS inbox tab → read the code aloud → **Phone A** types it → votes in the 3 categories (tap exhibitor → confirm) | the TV board moves within a second of each vote; the vote hub shows ✓ per category |
| **3:40–4:10** | "One phone number is one voter, however you type it, on whichever device." | **Operator:** in a private window, sign in again with Phone A's number written differently (`07…` vs `+962 7…`) and the new code. A new code for the same number is only allowed 60 s after the first, so start this no earlier than 1 minute after step 3's request | the app lands on a voter that has already voted: all three categories show ✓; a second vote is refused ("votes are final") |
| **4:10–5:15** | "Blind Hour. Suspense, but votes keep counting. The TV is sealed on the *server*, not just hidden on screen." | **Operator:** Overview → Results → **FROZEN** → confirm. **Phone B** signs in and casts votes. **Presenter** opens DevTools on the TV tab | TV shows the sealed board. Network → the `stream` frames carry no new counts. Operator's Overview shows the live total rising (admin-only, audit-logged) |
| **5:15–6:30** | "Now the winners, one category at a time." | **Operator:** Results → **REVEAL** (typed confirmation) → **Reveal** a category | full-screen ceremony on the TV (about 15 s); the winner stays as a final result; a late vote cannot change it |
| **6:30–7:15** | "Now we break it. One of the two servers dies in the middle of voting." | **Operator:** run `docker stop mc2026-api1-1`. **Phone B** votes in its last category. Then `docker start mc2026-api1-1` | the vote is accepted, nothing visible to the voter, the TV still updates |
| **7:15–7:45** | "We tested this at scale: 1,000 simulated visitors, 3,000 votes, zero lost, zero duplicated, p95 latency 10 ms, and each server killed in turn. The code, the 9 decision records, the threat model and the load report are in the repo." | — | Closing slide: the headline numbers ([`../load-test-report.md`](../load-test-report.md)) and the one-line honest limit: "the demo host is one laptop; production runs two zones and a database standby" |

## If you are running long: cut in this order

1. Step 4 (second sign-in with a different number format): say it, do not show it.
2. Step 6's `docker start` (restart after the demo).
3. Shorten step 1 (have the range pre-typed; still click Save).

Never cut the replica kill or the Blind Hour: they are the two moments that separate this from a form with a counter.

## Failure plan

| What goes wrong | Do |
|---|---|
| The tunnel or the room network is down | switch the laptop to the phone hotspot; `pnpm stack:tunnel`; if not back in 60 s, play the backup video |
| The SMS does not show in the inbox | refresh the SMS inbox tab; a resend is allowed after 60 s; otherwise continue with Phone B (a number that is already signed in) |
| "Find my address" suggests an unexpected range | accept it only after confirming Phone A reaches the access check with "inside"; the room's address is the phone's address |
| The TV shows "Reconnecting" | it self-recovers; say "the screen is reconnecting; that is the SSE resume", wait 3 s |
| A replica does not stop or start | `docker ps`; start it with `docker start mc2026-api1-1`; skip to the close |
| Total failure | backup video, then take questions from the [Q&A sheet](qa-sheet.md) |

## After the demo

`pnpm stack:reset-event` to remove the demo visitors and votes **before** any real event, and restore `.env` to `SMS_PROVIDER=http`, no `DEMO_MODE` ([`event-day.md`](../runbooks/event-day.md)).
