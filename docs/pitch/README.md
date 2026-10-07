# Pitch pack

Everything the team needs for Thursday 8 Oct 2026, 12:00. The pitch must run **under 8 minutes**, with a dress rehearsal Thursday 10:00–11:30.

| Document | Use |
|---|---|
| [`demo-script.md`](demo-script.md) | The 7 min 45 s live run: roles, room setup, timed steps, cut list, failure plan |
| [`qa-sheet.md`](qa-sheet.md) | Honest, short answers to the likely judge questions, grouped by criterion |
| [`backup-video.md`](backup-video.md) | What to record, when to switch to it, checklist |

Technical backing the presenters can point at: [architecture](../architecture.md) · [data model](../erd.md) · [data flows](../dfd.md) · [authentication](../auth.md) · [deployment](../deployment.md) · [scaling and load evidence](../scaling-1000-users.md) · [threat model](../security/threat-model.md) · [requirements traceability](../traceability.md).

## Rubric to evidence

| Criterion (weight) | The claim in one line | Show this |
|---|---|---|
| Problem understanding and fit (15 %) | Built around the real event: one shared venue IP, phones on 4G, Arabic speakers, TV in a hall, a room demo | Step 1–3 of the demo; ADR-002 |
| Functional completeness (20 %) | Visitor flow, TV board, Blind Hour, reveal, full organiser console, exports | The whole demo; [traceability](../traceability.md) (F1–F14 all ✅ except the printed QR) |
| Access control and anti-fraud (20 %, tiebreaker) | Venue-network gate on every sensitive call + one real phone = one voter, enforced by the database | Steps 2, 3, 5; [auth.md](../auth.md) |
| Scalability and soundness (15 %) | Stateless replicas, measured: 1,000 visitors, 3,000 votes, 0 lost, each server killed in turn | Step 8; [scaling](../scaling-1000-users.md) |
| UX and design (15 %) | Bilingual phone flow and a broadcast-grade TV board, on-brand | Steps 3, 4, 7 |
| Pitch and demo (15 %) | Scripted, rehearsed, a backup video, a Q&A sheet | This folder |

## Printed QR (a team task)

The entrance and booth signs open the app. Spec, so every phone scans it first time:

- Encodes exactly `https://vote.makercollective.app` (no tracking parameters). Test the printed sheet on at least one iPhone and one Android phone in the real venue light.
- Print at least 5 × 5 cm for a 50 cm scan distance (about 1:10 of the distance), larger for signs read from 1–2 m; error-correction level M or higher; a clear border of at least 4 modules; dark code on a light background; matte paper or laminate that does not glare under spotlights.
- Put the short address in text below the code, and the venue Wi-Fi name next to it ("1. join the Wi-Fi  2. scan").

## Team checklist (Thursday morning)

- [ ] 09:00 code freeze: only bug fixes found in rehearsal after this.
- [ ] Demo `.env` set (demo SMS inbox, demo mode) and clean slate verified (Overview shows 0 visitors, 0 votes).
- [ ] TV paired and full-screen; Wi-Fi name and password entered in Settings.
- [ ] Phone A and Phone B: numbers known, Wi-Fi saved, votes remaining for Phone B.
- [ ] Hotspot ready; laptop on mains; sleep disabled.
- [ ] Backup video on the desktop and on a second device; plays offline.
- [ ] The Q&A sheet printed; each person owns a topic (security, scale, UX, product).
- [ ] 10:00–11:30 dress rehearsal, timed: under 8 minutes.
- [ ] After the pitch: `stack:reset-event` before any real event.
