# Backup video

A recording of the demo that plays if the live one cannot. It is insurance, not a replacement: say "here is the recording from this morning" and keep talking over it. Length: **under 4 minutes**, no audio required (the presenter narrates live).

The recording itself is made by the team (it needs the real phones and the real room), so the file is **not** in the repository (large binary). Keep two copies: on the presenting laptop's desktop, and on a phone or USB stick.

## When to switch

Switch the moment any of these happens and 60 seconds of trying has not fixed it: the tunnel or network is down, the stack will not start, the TV does not pair. Never debug in front of the judges.

## What to record

Screen-record the laptop (QuickTime → New Screen Recording) at 1080p, with a phone shot by a second person or a screen mirror for the phone steps. Shot list follows the live script ([`demo-script.md`](demo-script.md)) so the narration is identical.

| # | Shot | Length | Must be visible |
|---|---|---|---|
| 1 | Console → Settings → Find my address → add the range → Save | 20 s | the range appears; the Overview warning clears |
| 2 | Phone on mobile data opens the app | 15 s | the "join the venue Wi-Fi" screen and the Wi-Fi name |
| 3 | Phone on Wi-Fi: sign-in → code in the SMS inbox → code entered → 3 votes | 60 s | the code appearing in the console, the ✓ per category |
| 4 | The TV board updating after each vote | 15 s | the board moving within a second (TV and phone in one frame if possible) |
| 5 | The same number signs in again in a private window | 15 s | all categories already ✓, a second vote refused |
| 6 | Blind Hour: FROZEN, second phone votes, DevTools Network on the TV tab | 40 s | the sealed board, the stream frames with no new counts, the console total rising |
| 7 | Reveal: one category, the ceremony | 25 s | the full-screen winner moment |
| 8 | `docker stop mc2026-api1-1`, a vote on the phone, `docker start …` | 30 s | the vote succeeds; the terminal and the TV in one view |
| 9 | Load-test summary slide | 10 s | 1,000 visitors, 3,000 votes, 0 lost, 0 duplicated |

## Recording checklist

- [ ] Do it **after** the dress rehearsal passes, on the final build, with the real branding and content.
- [ ] Hide notifications; close unrelated tabs and windows; bookmarks bar hidden; large browser zoom (125%) so a projector can read it.
- [ ] Use demo numbers only; check no real personal data is visible (the console shows masked numbers by default; do not click "reveal").
- [ ] Trim dead time, keep the replica kill uncut.
- [ ] Name it `mc2026-backup-demo.mp4`; check it plays full-screen with no network.
- [ ] Rehearse switching to it once: how long does it take to open and play? (target under 15 s).

## Also keep ready offline

- Screenshots of the TV board in each state (live, sealed, ceremony), the console overview and the architecture diagram (from [`../architecture.md`](../architecture.md)).
- The [`load-test-report.md`](../load-test-report.md) summary on one slide.
