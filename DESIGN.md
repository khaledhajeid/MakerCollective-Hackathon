---
name: MC2026 Voting
description: On-site award voting for the Maker Collective 2026 exhibition. A tactile, Arabic-first brand world in navy, purple and royal, in two variants (mobile voter app, hall TV dashboard).
colors:
  navy: "#00007b"
  navy-deep: "#00004a"
  purple: "#7f32d9"
  royal: "#4a68d8"
  turquoise: "#74dccf"
  yellow: "#f8d749"
  crimson: "#a52a3a"
  purple-soft: "#f1e9fc"
  royal-soft: "#e9edfb"
  turquoise-soft: "#e1f7f4"
  yellow-soft: "#fdf4cc"
  crimson-soft: "#fbe8ea"
  ink: "#0b0b3b"
  muted: "#55557a"
  line: "#dcdcee"
  canvas: "#f6f6fb"
  surface: "#ffffff"
  faint: "#8b8bab"
  skeleton: "color-mix(in oklab, #dcdcee 55%, #f6f6fb)"
  dim: "rgb(255 255 255 / 0.72)"
  navy-dim: "rgb(0 0 123 / 0.75)"
typography:
  display:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 800
    lineHeight: 1.12
  title:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 800
    lineHeight: 1.2
  heading:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.3
  tv-name:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: 1.25
  tv-secondary:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1.1
  tv-count:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "72px"
    fontWeight: 900
    lineHeight: 1
  control-text:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.3
  code-digit:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.1
  display-ar:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 700
    lineHeight: 1.35
  tile-initial:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 900
    lineHeight: 1
  tv-caption:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 400
    lineHeight: 1.1
  tv-caption-lg:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 400
    lineHeight: 1.2
  tv-subhead:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.2
  tv-stat:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 900
    lineHeight: 1
  tv-leader-name:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "60px"
    fontWeight: 700
    lineHeight: 1.2
  tv-card-name:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "64px"
    fontWeight: 700
    lineHeight: 1.25
  tv-title:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "80px"
    fontWeight: 700
    lineHeight: 1.2
  tv-display:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "96px"
    fontWeight: 900
    lineHeight: 1
  tv-hero-name:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "104px"
    fontWeight: 700
    lineHeight: 1.2
  tv-headline:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "120px"
    fontWeight: 700
    lineHeight: 1.2
  tv-poster-count:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "240px"
    fontWeight: 900
    lineHeight: 1
rounded:
  control: "1.125rem"
  card: "1.5rem"
  photo: "1.4rem"
  sheet: "2rem"
  pill: "9999px"
  tv-row: "32px"
  tv-chip: "28px"
  focus: "6px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  page-x: "20px"
  hero-x: "24px"
  tv-row-gap: "8px"
  tv-gutter: "28px"
components:
  button-primary:
    backgroundColor: "{colors.purple}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "56px"
    padding: "0 24px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    height: "56px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.royal}"
    rounded: "{rounded.control}"
    height: "48px"
  button-on-dark:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.navy}"
    rounded: "{rounded.control}"
    height: "56px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "56px"
    padding: "0 16px"
  category-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.navy}"
    rounded: "{rounded.card}"
    padding: "16px"
  category-card-voted:
    backgroundColor: "{colors.turquoise-soft}"
    textColor: "{colors.navy}"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  tv-row:
    backgroundColor: "{colors.navy-deep}"
    textColor: "{colors.surface}"
    rounded: "{rounded.tv-row}"
    height: "128px"
  tv-row-leader:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.navy}"
  tv-rail-chip:
    textColor: "{colors.surface}"
    rounded: "{rounded.tv-chip}"
    height: "144px"
---

# Design System: MC2026 Voting

## Overview

**Creative North Star: "The Workshop Banner"**

One brand world, the Maker Collective palette and its pattern vocabulary (chevron, gear, circle, triangle, spiral rings), expressed twice. On a phone it is a premium native-app feel: a navy hero with purple and royal glows over a light, navy-tinted canvas, one decision per screen, a thumb-sized purple button, and a bottom sheet for the irreversible step. On the hall TV it is the same navy turned into the ground, white poster-scale type, and one reserved colour (yellow) that always means "leading".

Depth is soft and navy-tinted, never grey. Motion is crisp: exponential ease-out entrances, spring press feedback, and a slow-turning dotted gear as the system's loading and "sealed" mark. Arabic is the first-class script; every layout is built RTL and Latin is fitted beneath or beside it.

**Key Characteristics:**
- Navy-tinted neutrals; no pure grey, no pure black text.
- Brand hues are saturated and few; soft tints (never new hues) carry state backgrounds.
- Purple is the voter action colour; yellow is the TV leader colour; turquoise means "yours / live / progress".
- Pattern motifs (chevron, dotted gear, rings, triangle, circle) are the only decoration. Icons are a single hand-drawn 2.2px round-cap stroke set.
- Two variants share tokens, fonts and motifs: voter (light canvas + navy hero) and TV (navy-deep ground on a 1920x1080 artboard).

## Colors

A deep-navy brand palette with one warm accent, tinted neutrals toward navy, and soft tints for state.

### Primary
- **Maker Navy** (`{colors.navy}`): hero grounds, headings and body-on-light text for titles, text on yellow and turquoise fills, TV QR/ground base. The brand anchor.
- **Maker Purple** (`{colors.purple}`): the voter primary button, focus ring on fields, "tap to choose" label, checked checkbox. White text on it passes AA.
- **Royal Blue** (`{colors.royal}`): global focus-visible outline (3px, offset 3px), ghost button text, info banners (on royal-soft), hero glow.

### Secondary
- **Signal Turquoise** (`{colors.turquoise}`): "yours / live / progress". Voter: picked exhibitor ring and badge, voted state, text selection. TV: LIVE dot and dwell progress only. Always navy text on it.
- **Leader Yellow** (`{colors.yellow}`): TV: the leader's row fill, leader counts on the rail, winner glow and winner count. Voter: sparing accent only (hero triangle motif, offline icon, warning tint). Always navy text on it.
- **Crimson** (`{colors.crimson}`): errors and refusals (text, field ring, alert icon). White text on it passes AA.

### Neutral
- **Ink** (`{colors.ink}`): default body text on light surfaces.
- **Muted Slate** (`{colors.muted}`): secondary text on canvas (6.6:1 on canvas).
- **Hairline Lavender** (`{colors.line}`): ring borders on fields and secondary buttons, sheet handle.
- **Faint Lavender** (`{colors.faint}`): non-text UI boundaries only: the checkbox ring and the "forward" chevron on category cards (3.3:1 on white, above the 3:1 floor for UI components). Never text; placeholders use Muted Slate.
- **Skeleton** (`{colors.skeleton}`): loading shimmer base, a mix of line and canvas (55/45 in oklab) defined in the token file.
- **TV Dim** (`{colors.dim}`): white at 72%, the single value for TV secondary (English) lines, `text-dim` across the live surface; about 11:1 on navy-deep.
- **TV Navy Dim** (`{colors.navy-dim}`): navy at 75%, the same role on the yellow leader row (`text-navy-dim`).
- **Canvas** (`{colors.canvas}`): page background of the voter app. **Surface** (`{colors.surface}`): cards, fields, sheet.
- **Navy Deep** (`{colors.navy-deep}`): TV ground base and QR modules.
- **Soft tints** (`purple-soft`, `royal-soft`, `turquoise-soft`, `yellow-soft`, `crimson-soft`): state backgrounds for notices, voted card, pressed rows.

### Named Rules
**The Never-On-White Rule.** Yellow and turquoise are never text on white or on canvas. On those fills the text is navy. Purple, royal and crimson carry white text.

**The Leader-Only Yellow Rule.** On the TV, yellow marks the leading exhibitor and the winner and nothing else; the TV's no-photo tile therefore excludes the yellow-ground variant. Turquoise on the TV means liveness only. Category colour appears only as the chevron next to the category name.

**The Tinted-Neutral Rule.** Greys are navy-tinted (ink, muted, line, canvas). Shadows are navy-tinted rgba, never black.

## Typography

**Display / Body Font:** Nexa (Regular 400, Bold 700, Heavy 800, Black 900), with Helvetica Neue Arabic (Light 300, Roman 400, Bold 700) and system-ui fallbacks.

**Character:** Geometric, confident Latin (Nexa) with a sober humanist Arabic (Helvetica Neue Arabic). One stack serves both scripts: Nexa has no Arabic glyphs, so Latin always lands in Nexa and Arabic falls through, which is correct for mixed lines.

### Hierarchy (voter, fixed rem steps, about 1.2 ratio, no fluid scaling)
- **Display** (800, 2.25rem, 1.12): welcome headline only. Arabic: 700, 2.125rem, 1.35.
- **Title** (800, 1.625rem, 1.2): screen titles, sheet title. Arabic: 700, 1.4 leading.
- **Heading** (700, 1.1875rem, 1.3): card and step titles, category header.
- **Body** (400, 1rem, 1.5): paragraphs; Arabic 1.75 leading.
- **Small** (400, 0.875rem, 1.45): hints, descriptions, errors (bold); Arabic 1.7.
- **Label** (700, 0.875rem, 1.3): field labels, badges, "tap to choose".
- Buttons 1.0625rem bold (md size 1rem); inputs 1.0625rem; OTP digits 1.75rem bold.

### Hierarchy (TV, design pixels on 1920x1080; size floor 40px)
- **Poster counts**: ceremony solo winner 240px; leader count 96px; ranked counts 72px; header numerals 52px; all Nexa Black (900), tabular numerals.
- **Names**: Arabic Bold 56px (leader 60px; sealed headline 120px; waiting 104px; ceremony solo 104px), English beneath Regular 40px (leader 42px) in Dim (`{colors.dim}`, white at 72%).
- **Chrome text**: header, pills, rail category: 40px minimum; rail leader name and count 56px.
- Nothing on the TV is below 40px.
- **Every TV size step** (design px): 40 secondary and chrome, 42 leader English, 44 category English and body, 48 secondary headlines, 52 header numerals, 56 names, 60 leader name, 64 joint-winner names, 72 ranked counts, 80 empty-state titles, 96 leader count and pairing title, 104 solo-winner name and waiting title, 120 sealed headline, 240 solo-winner count. The scale is deliberately wide: it is read from 3 to 25 metres, so each size answers one distance and role.
- **Voter sizes outside the six-step ramp:** control text 1.0625rem, OTP digit and system titles 1.75rem, Arabic display 2.125rem, and the no-photo tile initial 3.25rem.

### Named Rules
**The Both-Scripts Rule.** Arabic letter-spacing is always 0 (it breaks joining) and Arabic lines get more leading than Latin; Arabic display and title drop to Bold because that is its top weight.

**The Arabic-Above Rule.** On the TV, Arabic is large and primary, English sits smaller beneath in its own LTR span (`lang="en"`, `dir="ltr"`) hanging from the same right edge. Truncated names carry padding with equal negative margin so descenders are never clipped.

## Layout

**Voter:** a single column, max 28rem wide (`max-w-md`), centred; on wider screens it becomes a rounded (2.5rem) card on a dark backdrop. Page gutters 20px (`px-5`), hero gutters 24px (`px-6`). Rhythm is Tailwind 4px steps: 12 to 16px inside lists, 24px between photo cards. Top insets use `env(safe-area-inset-top)`; the sticky action bar clears the home indicator with `env(safe-area-inset-bottom)` over a canvas-to-transparent fade. Primary action lives in the thumb zone (bottom). Short viewports (under 700px high) shrink the welcome hero to 44dvh and hide step details. Every tap target is at least 48px (language toggle `min-h-12`, back and search-clear buttons `size-12`, text links `min-h-12`, checkbox rows full-width 48px) and primary controls are 56px; the sheet's 36px drag handle is a pointer-drag region, not a button.

**TV:** a fixed 1920x1080 artboard (`dir="rtl"`, `lang="ar"`), scaled by `min(w/1920, h/1080)` and centred; non-16:9 screens get navy-deep bars. Content is Header 80px, Stage (title row 76px, five rows of 128px with 8px gaps), Rail 144px, with 12px between stage parts. Rows use a 4-column grid: rank 84px, photo 104px, name flexible, count auto, 28px gap and gutter. The whole picture drifts 7px/5px over 240s to prevent burn-in. Z-order: sticky 20, banner 40, sheet 60 (voter); ceremony overlay z-50 (TV).

## Elevation & Depth

Hybrid: tonal layering first, soft navy-tinted shadows for lift. Cards sit on canvas by white surface plus a shadow; the TV has no shadows, only translucent white layers (`white/5`, `/7`, `/16`) over the ground.

### Shadow Vocabulary
- **Card** (`0 1px 2px rgb(0 0 123 / 0.06), 0 10px 28px -6px rgb(0 0 123 / 0.12)`): category cards, step icon tiles, vote sheet photo.
- **Raised** (`0 2px 4px rgb(0 0 123 / 0.08), 0 16px 36px -8px rgb(0 0 123 / 0.22)`): defined as a token for lifted elements.
- **Sheet** (`0 -12px 48px rgb(0 0 60 / 0.28)`): the bottom sheet only.
- **Primary button** (purple glow `0 10px 22px -8px rgb(127 50 217 / 0.7)` plus a 1px inset top highlight): gives the button its tactile "key" look. On-dark button uses a deep navy drop plus a 3px inset bottom edge.
- **Voted card**: a 1.5px turquoise outline ring plus a soft navy drop.

### Named Rules
**The Navy-Shadow Rule.** Shadows are always navy-tinted at low alpha and long blur. No hard offset shadows, no black drops.

**The Flat-TV Rule.** The TV expresses hierarchy by fill and scale (yellow leader, translucent rows, poster type), not shadow.

## Shapes

Soft and generous: controls 18px (1.125rem), cards 24px (1.5rem), exhibitor photos 22px (1.4rem), the sheet's top corners 32px (2rem), pills and icon buttons fully round. The chevron triangle (right-pointing, `M44.6 25.7 0 0v51.4Z`) is the signature silhouette and flips under RTL. TV scale-up: rows 32px, rail chips 28px, QR 14px, sealed/waiting panels 40px. Borders are inset rings (1.5px line colour; 2.5px purple on focus) rather than box borders; the TV's empty rank slots use a 3px dashed 13% white outline.

## Components

### Buttons
- **Shape:** 18px radius, full width, min height 56px (`lg`) or 48px (`md`); bold text 1.0625rem.
- **Primary:** purple fill, white text, purple glow shadow; disabled is purple at 45% (`bg-purple/45`, no shadow).
- **Secondary:** white surface, navy text, 1.5px line ring. **Ghost:** transparent, royal text. **On-dark:** white, navy text, for hero grounds.
- **States:** press scales to 0.96 with a fast spring plus a haptic tick; `loading` shows the dotted gear, sets `aria-busy`, and ignores taps so a double tap cannot submit twice. Focus uses the global 3px royal outline.

### Fields
- **Style:** label above the control (not floating), white fill, 1.5px inset ring in line colour, 56px min height, text 1.0625rem (never under 16px).
- **Focus:** ring thickens to 2.5px and turns purple. **Error:** crimson ring and a bold crimson message with an alert icon that says what to do next. Hint is muted small text; placeholders use Muted Slate (`text-muted`, 4.5:1 or better).
- **OTP:** six visual cells over one real input (autofill, paste, numeric keyboard work); active cell purple ring, filled cells scale 1.03, invalid crimson on crimson-soft. Always LTR. Checkbox rows are 48px tall, whole-row targets.

### Category and exhibitor cards
- **Category card:** white surface, 24px radius, 16px padding, a 60px colour tile (category colour with navy-or-white glyph chosen by luminance) carrying a cycled brand motif (gear, circle, triangle, chevrons), title in navy, forward arrow flipped for RTL. **Voted:** turquoise-soft with turquoise ring and a navy check badge.
- **Exhibitor card:** photo-led, 16:10 image at 22px radius, name and two-line project beneath, booth chip bottom-end. **Picked:** 3px turquoise ring with offset and a turquoise "your pick" badge in navy text. **Locked others:** 55% opacity.
- Press scale 0.975.

### Bottom Sheet
A native `<dialog>` with a 32px top radius, 24px side padding, a drag handle (44x6 pill in line colour inside a 36px-high drag region), navy dim backdrop (`rgb(0 0 50 / 0.58)`), spring entrance, drag-to-dismiss at 110px or 0.6px/ms, locked while a vote is in flight. Content: photo, restated choice, confirm button, ghost cancel; success shows the ray celebration; offline shows a yellow-soft notice and retries.

### Hero and chrome
Navy hero with two radial glows (purple top-end, royal bottom-start; a teal variant for gate/system screens) and slowly turning concentric rings. Language toggle (pill, 48px, labelled in the target language) is always visible. Offline banner is a sticky ink strip with a yellow icon. Chevron trail (one triangle per category, filled in brand order as votes land) is the progress device. Skeletons use a navy-tinted shimmer built from the skeleton token.

### TV: Stage and rail
- **Row:** 128px, 32px radius, translucent white 7% base; the row itself is the bar (fill scaleX to share of leader). **Leader** row is solid yellow with navy text, 60px name, 96px count. Non-leader fill white 15%. Rows slide to new rank in 900ms and cascade in at 70ms steps.
- **Title row:** category-colour chevron, Arabic 56px bold, English 40px, dwell segments (64x10px pills; turquoise fills over the dwell period).
- **Rail:** one chip per category (28px radius, white 7%, active 16% with turquoise 20% dwell fill), lock icon when sealed, leader name 56px and yellow count; with more than four categories only the active chip keeps text and others collapse to marker plus count. Static QR (white tile, navy-deep modules, 120px) with "Scan to vote" at the end.
- **Header:** logo, status pill (LIVE with pulsing turquoise dot, sealed with lock, results), total votes, closing countdown; offline shows a white pill with navy text.
- **Ceremony:** full-screen over the ground with turning rings and a huge faint gear; chevron and category, yellow glow behind the winner photo, count climbs from zero, runners-up in two translucent cards. Winner sizes scale by number (solo 420px photo, up to three 260px, more 150px). Runs 15s then returns to final standings.
- **Sealed / Waiting / Pairing:** panels on the ground with rings and one slow dotted gear (sealed shows no numbers at all); waiting adds a 380px QR; pairing is a 96px-high field and white button.

### Signature: the no-photo tile
A deterministic brand tile (seeded by exhibitor id) in one of five brand grounds with faint rings, one circle/triangle/dotted-ring accent and the initial in Nexa Black (Latin) or Helvetica Neue Arabic Bold (Arabic initials, the face's top weight). Reads as designed, not as a missing image. The TV scales a 160px tile and drops the yellow ground.

### Motion
Entrances use `cubic-bezier(0.25, 1, 0.5, 1)` (quart) or `cubic-bezier(0.16, 1, 0.3, 1)` (expo). Springs: press (stiffness 700, damping 32), soft (380/34), sheet (420/38). Voter and TV animate transform and opacity only. Reduced motion collapses durations to near zero; on the TV staged delays go to zero and the dwell fill is hidden so it does not look finished from frame one. Haptics and sound are enhancements only; the TV has no sound.

### RTL and bidi
Layout is authored with logical properties (`start`/`end`, `ps`/`pe`); arrows, chevrons and the chevron trail flip under RTL (`rtl:-scale-x-100`, `Icon flip`). Digits are Western (Latin) everywhere: `ar-JO-u-nu-latn` for dates, input digits normalised to ASCII. Numbers, phone and times are `.num` (tabular, `direction: ltr`, `unicode-bidi: isolate`) or wrapped in LRI/PDI. Mixed-language names use `dir="auto"` on the voter app and `bdi` / separate `lang`+`dir` spans on the TV so `&`, digits and punctuation never reorder.

## Do's and Don'ts

### Do:
- **Do** put the primary action in the thumb zone as a 56px purple (or on-dark white) button with press scale and haptic.
- **Do** use navy text on yellow and turquoise fills; white on purple, royal and crimson.
- **Do** keep yellow on the TV for the leader and winner only, and turquoise for liveness and progress.
- **Do** write every error and refusal so it says what happened and what to do next.
- **Do** keep TV text at 40px or more, names at 56px or more, and counts at 72px (leader 96px) or more.
- **Do** keep Western digits and isolate numbers inside Arabic text.
- **Do** animate only transform and opacity, with a reduced-motion alternative.
- **Do** use the shared motifs (chevron, dotted gear, rings, triangle, circle) as the only decoration, and the no-photo tile for missing images.

### Don't:
- **Don't** set yellow or turquoise text on white or canvas.
- **Don't** add letter-spacing to Arabic, or use fluid type on the voter app (steps are fixed rem).
- **Don't** introduce new brand hues; extend with tints of the six brand colours only.
- **Don't** use gradient text, confetti, glass cards, or hard offset shadows; the anti-references are generic SaaS card grids, government-form density, and casino-style gamification.
- **Don't** show "voted" before the server confirms; the vote sheet says recorded only after success.
- **Don't** let the TV hide or invent numbers: the server decides what is sealed, the client renders it.

### Known inconsistencies in the build (recorded, not canonized)
- Voter focus ring (3px royal, 6px radius) is global, while fields suppress it and use their own purple ring; both are intended, but the ring colour differs.
