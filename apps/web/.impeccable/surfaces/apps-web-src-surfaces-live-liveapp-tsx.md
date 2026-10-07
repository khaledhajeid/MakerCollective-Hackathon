---
version: 1
slug: "apps-web-src-surfaces-live-liveapp-tsx"
primary_target: "apps/web/src/surfaces/live/LiveApp.tsx"
related_targets: []
---

# Live TV board (/live)

Mode: Operate (glance surface). Audience: people in the hall looking up from 3-25 m for 3-5 s, plus organisers and judges. Task: see who leads every category, trust that it is live, feel the Blind Hour tension, watch the reveal. Constraints: 1920x1080 artboard scaled to any 16:9 TV, Arabic primary with English beneath, RTL first, full names always (wrap, never truncate), transform/opacity animation, never a blank screen. The server decides what is sealed; the client never hides data.

Redesign requested 2026-10-07 by the owner: the old stage-and-rail board was "complicated and not smooth", cut names with an ellipsis, and the reveal looked broken. Owner decisions (pinned, no direction roll): all categories side by side, reveal as winner then podium; light ground first, then changed by the owner to DARK (2026-10-07), with a clearer podium and one consistent yellow. Third redesign round (2026-10-07, owner: "too busy, motion or places unclear, the colour not compatible"): one accent only, fewer elements. Brand palette and Nexa / Helvetica Neue Arabic stay.

## Direction contract

THESIS: Every race on one calm board: a column per category, no rotation, no timers, no rail. What the hall needs is on screen at once and nothing moves unless a vote lands. Refuses the stage-and-rail rotation, progress segments, truncated names, and a reveal that fades over the board.

OWN-WORLD: Flat dark navy-deep ground with one quiet royal glow; no second hue on the board. Categories are plain white titles with a white chevron (no colour slabs, no sheets). The podium is a three-step ladder of separate rounded blocks: FIRST solid yellow (the only yellow on the TV; photo with navy medal, 96px count, unit), SECOND solid white with navy medal and 80px count, THIRD pale glass (white 9%, hairline ring) with a pale medal and 60px count. Blocks step down in height, gaps between, open places are dashed outlines. No share bars, no per-row unit (the leader carries the "votes" unit; others have it for screen readers). The ceremony curtain is brighter brand navy with one glow; winner gets a solid yellow frame; runners-up repeat the white and glass blocks. Chevron and rings only; no glass blur, no gradient text, no confetti.

STORY: Glance up and see each category's top three and that the numbers are live. In Blind Hour the columns hold the sealed snapshot with a lock; hidden or not-yet-revealed shows a sealed screen with no numbers. In Reveal each winner arrives as a full-screen scene (and the winner is, the winner, then second and third), then the column unlocks and stays as a final result.

FIRST VIEWPORT: 48px frame. Header 88px. Below, N columns (3 at the event) 800px tall, 32px apart: title 108px+ (no fill), then three blocks 14px apart: leader about 250px (photo 120, name, count), second about 200px, third about 160px. Footer 96px with QR.

FORM: user-pinned three-column board; no seed roll.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
