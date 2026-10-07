---
version: 1
slug: "src-surfaces-live-liveapp-tsx"
primary_target: "src/surfaces/live/LiveApp.tsx"
related_targets: []
---

# Live TV dashboard (/live)

Mode: Operate (glance surface). Audience: people in the hall looking up from 3-25 m for 3-5 s, plus organisers and judges. Task: see who leads each category, trust that it is live, feel the Blind Hour tension, watch the reveal. Constraints: 1920x1080 artboard scaled to any 16:9 TV, nothing under 40px, names >=56px, leader count >=96px, Arabic primary with English beneath, RTL first, transform/opacity animation only, never a blank screen. Server decides what is sealed; the client never hides data.

## Direction contract

THESIS: One category owns the whole stage at poster scale while a rail keeps every race in view, so the hall reads one clear story at a time. Refuses the equal-card three-column dashboard and the hero-metric tile.

OWN-WORLD: Navy ground (navy-deep to navy with quiet brand glows), white type, yellow reserved for the leader only, turquoise only for liveness (LIVE dot, dwell progress). Category colour appears only as the stage-title pill and rail dot. Nexa Heavy numerals, Helvetica Neue Arabic Bold names with the English line smaller beneath. Brand gear, chevron and ring motifs; the sealed state is one slow-turning gear ring. No glass, no gradient text, no confetti, no sound.

STORY: Glance up and know the leader of each category and that the numbers are live. In Blind Hour the room sees a sealed screen and no numbers at all. In Reveal each winner arrives as a ceremony, then stays as a final result.

FIRST VIEWPORT: Header 80px (logo, LIVE badge, total votes, closing countdown). Stage title row 76px (category pill, Arabic 56px over English 40px, dwell segments). Five ranked rows of 128px: rank, photo, name block with the row itself as the bar (its fill is the share of the leader), count (72px; leader 96px on a yellow panel). Bottom rail 144px: one chip per category with its leader, the active chip filling with dwell progress, the static Scan-to-vote QR at the end.

FORM: Stage and rail, position 3 of 7 on the ordered structure list (seed key 90b3da32).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
