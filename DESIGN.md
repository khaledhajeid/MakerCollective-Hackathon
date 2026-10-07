---
name: MC2026 Voting
description: On-site award voting for the Maker Collective 2026 exhibition. A tactile, Arabic-first brand world in navy, purple and royal, in two variants (mobile voter app on a light canvas, dark hall TV board with a brighter navy ceremony curtain).
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
  tv-name-max:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 700
    lineHeight: 1.32
  tv-name-min:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.32
  tv-chrome:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1.3
  tv-unit:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
  tv-second-count:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "80px"
    fontWeight: 900
    lineHeight: 1
  tv-third-count:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "60px"
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
  tv-stat:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 900
    lineHeight: 1
  tv-body:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 700
    lineHeight: 1.3
  tv-connecting-title:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "80px"
    fontWeight: 700
    lineHeight: 1.3
  tv-leader-count:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "96px"
    fontWeight: 900
    lineHeight: 1
  tv-pairing-title:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "96px"
    fontWeight: 700
    lineHeight: 1.2
  tv-screen-title:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "104px"
    fontWeight: 700
    lineHeight: 1.25
  tv-sealed-headline:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "120px"
    fontWeight: 700
    lineHeight: 1.25
  tv-ceremony-name:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "128px"
    fontWeight: 700
    lineHeight: 1.32
  tv-ceremony-announce:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "136px"
    fontWeight: 700
    lineHeight: 1.3
  tv-ceremony-count:
    fontFamily: "Nexa, Helvetica Neue Arabic, system-ui, sans-serif"
    fontSize: "170px"
    fontWeight: 900
    lineHeight: 1
rounded:
  control: "1.125rem"
  card: "1.5rem"
  photo: "1.4rem"
  sheet: "2rem"
  pill: "9999px"
  tv-block: "28px"
  tv-panel: "40px"
  tv-runner: "32px"
  tv-photo: "30px"
  tv-input: "28px"
  focus: "6px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  page-x: "20px"
  hero-x: "24px"
  tv-frame-x: "48px"
  tv-col-gap: "32px"
  tv-cell-x: "26px"
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
  tv-board:
    backgroundColor: "{colors.navy-deep}"
    textColor: "{colors.surface}"
  tv-column:
    backgroundColor: "transparent"
    textColor: "{colors.surface}"
    height: "800px"
  tv-column-head:
    backgroundColor: "transparent"
    textColor: "{colors.surface}"
    padding: "0 13px"
  tv-first-block:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.navy}"
    rounded: "{rounded.tv-block}"
    padding: "14px 26px"
  tv-second-block:
    backgroundColor: "rgb(255 255 255 / 0.2)"
    textColor: "{colors.surface}"
    rounded: "{rounded.tv-block}"
    padding: "14px 26px"
  tv-third-block:
    backgroundColor: "rgb(255 255 255 / 0.08)"
    textColor: "{colors.surface}"
    rounded: "{rounded.tv-block}"
    padding: "14px 26px"
  tv-ceremony:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.surface}"
---

# Design System: MC2026 Voting

## Overview

**Creative North Star: "The Workshop Banner"**

One brand world, the Maker Collective palette and its pattern vocabulary (chevron, gear, circle, triangle, spiral rings), expressed twice. On a phone it is a premium native-app feel: a navy hero with purple and royal glows over a light, navy-tinted canvas, one decision per screen, a thumb-sized purple button, and a bottom sheet for the irreversible step. On the hall TV it is the same world after dark: a flat navy-deep board with one royal glow, a plain white category title with a white chevron over each column, poster-scale white type, and a podium that is a ladder of separate rounded blocks from loud to quiet: solid yellow first, light glass second, darker glass third, with yellow reserved for first place alone. The winner ceremony is a brighter scene on top: an opaque brand-navy curtain with a dimmer royal glow that slides up over the board.

Depth is soft and navy-tinted, never grey. Motion is crisp: exponential ease-out entrances, spring press feedback, and a slow-turning dotted gear as the system's loading and "sealed" mark. Arabic is the first-class script; every layout is built RTL and Latin is fitted beneath or beside it.

**Key Characteristics:**
- Navy-tinted neutrals; no pure grey, no pure black text.
- Brand hues are saturated and few; soft tints (never new hues) carry state backgrounds.
- Purple is the voter action colour; yellow is the TV first-place colour; turquoise means "yours / live / progress".
- Pattern motifs (chevron, dotted gear, rings, triangle, circle) are the only decoration. Icons are a single hand-drawn 2.2px round-cap stroke set.
- Two variants share tokens, fonts and motifs: voter (light canvas + navy hero) and TV (dark navy-deep board on a 1920x1080 artboard; the ceremony curtain is the brighter brand navy).

## Colors

A deep-navy brand palette with one warm accent, tinted neutrals toward navy, and soft tints for state.

### Primary
- **Maker Navy** (`{colors.navy}`): hero grounds, headings and body-on-light text for titles, text on yellow and turquoise fills, the TV ceremony curtain ground, and text and medal numerals on the TV's yellow first place. The brand anchor.
- **Maker Purple** (`{colors.purple}`): the voter primary button, focus ring on fields, "tap to choose" label, checked checkbox. White text on it passes AA.
- **Royal Blue** (`{colors.royal}`): global focus-visible outline (3px, offset 3px), ghost button text, info banners (on royal-soft), hero glow. On the TV it is only the single glow on the board and ceremony grounds.

### Secondary
- **Signal Turquoise** (`{colors.turquoise}`): "yours / live / progress". Voter: picked exhibitor ring and badge, voted state, text selection. TV: the LIVE dot only. Category colours are not used on the TV at all. Always navy text on it.
- **First-Place Yellow** (`{colors.yellow}`): TV: first place and nothing else: the solid first-place block (or each tied-first row), and in the ceremony the solid winner frame, the winner count and the "joint winners" headline. Voter: sparing accent only (hero triangle motif, offline icon, warning tint). Always navy text on it.
- **Crimson** (`{colors.crimson}`): errors and refusals (text, field ring, alert icon). White text on it passes AA.

### Neutral
- **Ink** (`{colors.ink}`): default body text on light surfaces.
- **Muted Slate** (`{colors.muted}`): secondary text on canvas (6.6:1 on canvas).
- **Hairline Lavender** (`{colors.line}`): ring borders on fields and secondary buttons, sheet handle.
- **Faint Lavender** (`{colors.faint}`): non-text UI boundaries only: the checkbox ring and the "forward" chevron on category cards (3.3:1 on white, above the 3:1 floor for UI components). Never text; placeholders use Muted Slate.
- **Skeleton** (`{colors.skeleton}`): loading shimmer base, a mix of line and canvas (55/45 in oklab) defined in the token file.
- **TV Dim** (`--color-dim`, set once on `.tv-dark`): the secondary (English) text colour, `text-dim`, white at 72% (`{colors.dim}`) on the board, the pairing screen and the ceremony.
- **TV Navy Dim** (`{colors.navy-dim}`): navy at 75%, the same role on yellow (first-place band, tied rows) and on the white offline pill.
- **TV Veils**: the board's surfaces are white at low alpha, never a new hue: second-place block 20% with a 30% ring, third-place block 8% with a 15% ring, sealed column panel 6%, open-slot dashed outline 10% (its numeral disc 30%), paging dots 30%.
- **Canvas** (`{colors.canvas}`): page background of the voter app. **Surface** (`{colors.surface}`): cards, fields, sheet.
- **Navy Deep** (`{colors.navy-deep}`): the TV board ground (`.tv-ground`: flat navy-deep under one royal glow at top-end, 22%), the artboard bars, and the QR modules (the QR sits on a white tile). The ceremony curtain (`.tv-ground-ceremony`) is the brighter `{colors.navy}` under a dimmer royal glow (20%, top-centre), so it reads as a different scene.
- **Soft tints** (`purple-soft`, `royal-soft`, `turquoise-soft`, `yellow-soft`, `crimson-soft`): state backgrounds for notices, voted card, pressed rows.

### Named Rules
**The Never-On-White Rule.** Yellow and turquoise are never text on white or on canvas. On those fills the text is navy. Purple, royal and crimson carry white text.

**The First-Place-Only Yellow Rule.** On the TV, yellow means first place and nothing else, in every scene: the first-place block or tied-first blocks, the ceremony winner's solid frame, count and "joint winners" line. Second is light glass and third darker glass, in the same place everywhere (`SKIN`, `PLACE_STYLE`). Placeholder photo tiles on the TV drop every yellow (`MotifTile noYellow`: no yellow ground, yellow accents turn white), and the offline notice is a white pill. Turquoise on the TV means liveness only (the LIVE dot).

**The Plain-Title Rule.** On the TV a category title is plain white type with a white chevron, no slab, edge or category colour, so nothing competes with the podium ladder.

**The Dark-Board, Brighter-Curtain Rule.** The whole TV is dark: white type on navy-deep, `--color-dim` white 72%. The ceremony is not a switch to dark but a switch of ground: the brand navy with a dimmer glow, opaque, over the board. Never put navy text on the board except on yellow or white fills.

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

### Hierarchy (TV, design pixels on 1920x1080)
- **Names are fitted, never truncated.** `layout.ts` gives every name the largest tier at which it fits its box and wraps it; the Arabic/English pairs (px) run 52/42, 48/40, 44/38, 40/35, 36/32, 32/29, 28/26, 24/22, 21/20 for the longest. Arabic Bold, English Regular beneath in Dim. A name with no Arabic uses the large size for its English line. Category heads use the same tiers. The podium steps down in type too: first place may use the whole ladder (from 52/42, the leader gets the largest tier), second starts at 48/40, third at 44/38 (`TIER_FLOOR`). Category titles start at 44/38.
- **Counts step down by place**: first 96px, second 80px, third 60px (tied-first blocks use the third-place size, 60px); header numerals 52px; all Nexa Black (900), tabular numerals. Only the solo leader's count shows a visible "votes / صوت" unit (34px Arabic Bold, 30px English); second and third carry it for screen readers only, because the leader's unit already names the numbers. The small unit (28/26px) is used in the ceremony strip headers.
- **Medals**: the place numeral is 56% of its disc: 64px navy disc on the first-place block, 76px white disc second, 60px glass disc third (about 36, 43 and 34px numerals); open slots show a 64px outlined disc with a 36px number.
- **Chrome**: header, pills, scan-to-vote and empty-state lines are 40px (the lowest regular size); the "sealed" label in a sealed column is 48/36px.
- **Screens**: sealed headline 120px, waiting title 104px, pairing title 96px, connecting title 80px, secondary headlines 56px.
- **Winner ceremony (poster tiers 128/64 down to 40/32)**: announcement "And the winner is…" 136px Arabic (64px English); winner count 170px with a 48/40px votes line (104px for two or three joint winners, 72px for more); winner name starts at the 128px tier for a solo winner, 64px for a few, 56px for many; second and third place in the reserved strip use the 64-tier (from the fifth tier down) and 72px counts.
- The scale is wide on purpose: it is read from 3 to 25 metres. The old "nothing under 40px" floor no longer holds, because fitted names step down to 21px to stay whole; the guarantee is now that no name is ever clipped.
- **Voter sizes outside the six-step ramp:** control text 1.0625rem, OTP digit and system titles 1.75rem, Arabic display 2.125rem, and the no-photo tile initial 3.25rem.

### Named Rules
**The Both-Scripts Rule.** Arabic letter-spacing is always 0 (it breaks joining) and Arabic lines get more leading than Latin; Arabic display and title drop to Bold because that is its top weight.

**The Arabic-Above Rule.** On the TV, Arabic is large and primary, English sits smaller beneath in its own LTR span (`lang="en"`, `dir="ltr"`) hanging from the same right edge. Wrapped names carry padding with equal negative margin so descenders are never clipped.

## Layout

**Voter:** a single column, max 28rem wide (`max-w-md`), centred; on wider screens it becomes a rounded (2.5rem) card on a dark backdrop. Page gutters 20px (`px-5`), hero gutters 24px (`px-6`). Rhythm is Tailwind 4px steps: 12 to 16px inside lists, 24px between photo cards. Top insets use `env(safe-area-inset-top)`; the sticky action bar clears the home indicator with `env(safe-area-inset-bottom)` over a canvas-to-transparent fade. Primary action lives in the thumb zone (bottom). Short viewports (under 700px high) shrink the welcome hero to 44dvh and hide step details. Every tap target is at least 48px (language toggle `min-h-12`, back and search-clear buttons `size-12`, text links `min-h-12`, checkbox rows full-width 48px) and primary controls are 56px; the sheet's 36px drag handle is a pointer-drag region, not a button.

**TV:** a fixed 1920x1080 artboard (`dir="rtl"`, `lang="ar"`), scaled by `min(w/1920, h/1080)` and centred; non-16:9 screens get navy-deep bars. Frame padding is 48px sides and 32px top and bottom, 16px between parts: Header 88px, Board 800px, Footer 96px (QR 88px with "scan to vote", and 16px page dots when there is more than one page). The board is one column per category side by side with a 32px gap, up to four across; more than four are shown in pages of three, and the page advances every 14s (page dots in the footer; this is the only timer left on the board). Column width is `(1824 - gaps) / n`. Inside a column the head is at least 108px and as tall as the tallest head on the board, so the podium blocks line up across all columns. Below it the podium is separate blocks with a 14px gap that step down in height by place: weights 1.8 for a solo first, 1.2 second, 0.95 third; when first place is tied each tied block has weight 1. At most five blocks. Open slots (dashed outline) take the height of the place they stand for, so every column's podium lines up with its neighbours until three exhibitors have votes. Blocks use 26px side and 14px vertical padding. The whole picture drifts 7px/5px over 240s to prevent burn-in. Z-order: sticky 20, banner 40, sheet 60 (voter); ceremony curtain z-50 (TV), with the board behind it `inert`.

## Elevation & Depth

Hybrid: tonal layering first, soft navy-tinted shadows for lift. Cards sit on canvas by white surface plus a shadow. The TV board has no shadows at all: the ground is flat navy-deep with one royal glow, and depth is the place ladder itself: solid yellow, 20% white glass with a ring, 8% white glass with a fainter ring. The ceremony is flat too (the same glass blocks as runners-up over the brand-navy curtain, a solid yellow frame behind the winner).

### Shadow Vocabulary
- **Card** (`0 1px 2px rgb(0 0 123 / 0.06), 0 10px 28px -6px rgb(0 0 123 / 0.12)`): category cards, step icon tiles, vote sheet photo (voter only).
- **Raised** (`0 2px 4px rgb(0 0 123 / 0.08), 0 16px 36px -8px rgb(0 0 123 / 0.22)`): defined as a token for lifted elements.
- **Sheet** (`0 -12px 48px rgb(0 0 60 / 0.28)`): the bottom sheet only.
- **Primary button** (purple glow `0 10px 22px -8px rgb(127 50 217 / 0.7)` plus a 1px inset top highlight): gives the button its tactile "key" look. On-dark button uses a deep navy drop plus a 3px inset bottom edge.
- **Voted card**: a 1.5px turquoise outline ring plus a soft navy drop.

### Named Rules
**The Navy-Shadow Rule.** Shadows are always navy-tinted at low alpha and long blur. No hard offset shadows, no black drops.

**The Ring-Not-Shadow TV Rule.** On the TV, hierarchy is the block fill (yellow, glass, darker glass), block height and type size, and blocks are separated by a 14px gap and a hairline white ring on the glass, never a shadow.

## Shapes

Soft and generous: controls 18px (1.125rem), cards 24px (1.5rem), exhibitor photos 22px (1.4rem), the sheet's top corners 32px (2rem), pills and icon buttons fully round. The chevron triangle (right-pointing, `M44.6 25.7 0 0v51.4Z`) is the signature silhouette and flips under RTL. TV scale-up: podium blocks and the sealed column panel 28px (every place is its own rounded block), waiting panels 40px, first-place photo 30px, ceremony runner cards 32px, pairing field and button 28px, QR 14px. Place badges are full-round medals (navy on the yellow block, white on second, glass on third), the first-place one overlapping the photo's top-start corner with a 4px yellow cut-out ring. Borders are inset rings (1.5px line colour; 2.5px purple on focus) rather than box borders; TV glass blocks carry a 1px inset white ring (30% second, 15% third) and open slots use a 3px dashed 10% white outline. There are no share bars.

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

### TV: Board
- **Column:** no sheet and no ring: the column is the category title over a stack of podium blocks, straight on the flat navy-deep ground (800px tall). The title is plain white fitted Arabic over dim English, with a 40px white chevron (no outline, no category colour). A lock (44px) sits in the head when Blind Hour shows the sealed snapshot. A sealed column (or the category currently being announced) shows a 28px-radius 6% white panel with a 72px lock and "sealed / مغلق" and no numbers.
- **Podium as a ladder of blocks:** each place is its own 28px-radius block, loud to quiet, from `SKIN` and `PLACE_STYLE`, used the same way everywhere on the TV. Blocks step down in height (weights 1.8 / 1.2 / 0.95), count (96 / 80 / 60px) and largest name tier, so the order reads even without colour.
- **First place (solo):** a solid yellow block, navy text: photo (104px, 30px radius) with a 64px navy medal (yellow numeral, 4px yellow ring) on its top-start corner, and on the top line the 96px count over a large "votes / صوت" unit in navy; the fitted name, largest tier, beneath in full width, English in Navy Dim. **Tied first:** every tied exhibitor is a yellow block of weight 1 (navy medal, 60px count).
- **Second:** light glass (white 20%, 1px 30% white ring), white text, a 76px white medal with navy numeral, the fitted name, an 80px count. **Third:** darker glass (white 8%, 15% ring), a 60px glass medal (white 24%) with white numeral, a 60px count. Second and third show no visible unit (screen-reader text only). Open slots are dashed outlines (3px, 10% white) at the height of their place with a 64px outlined numeral disc; an empty column says "no votes yet".
- **Live morph:** one `li` per exhibitor, keyed by id, so a block that changes place glides in place: transform, height, background-colour and text colour ease over 800ms (expo) while the content (photo/medal/name/count) is swapped by a fade that starts after 150ms.
- **Header:** logo, status pill (white 10% pill with a 15% ring, white text: LIVE with pulsing turquoise dot, sealed with lock, results), total votes, closing countdown. Offline, the pill for "Live" is replaced entirely by the reconnecting notice (white pill, navy text, signal icon) and the countdown is hidden, so the screen never claims liveness it has lost.
- **Footer:** static QR (88px, white tile, navy-deep modules) with "Scan to vote", and page dots 16px high (white; the current dot a 72px bar, others 16px at 30% white).
- **Ceremony:** a brighter scene over the board. An opaque brand-navy curtain (`.tv-ground-ceremony`: one dimmer royal glow, slowly turning white 5% rings, no gear) slides up over the inert board and slides down to leave. Three beats: the announcement (136px, white; yellow only for "joint winners"), the winner (a solid yellow frame, 24px larger than the photo on every side, behind the photo; yellow count climbing from zero, solo photo 460px, a few 250px, many 150px), then second and third place as the same glass blocks (20% with ring, 8% with ring; 84px medal, 150px photo, 72px count) in a reserved 224px strip so the winner never moves. Runs 16s, then the board returns showing the final standings.
- **Sealed / Waiting / Pairing:** sealed and waiting are full-board translucent white 40px panels (5% white, 10% ring) with a slow dotted gear (sealed shows no numbers at all; waiting adds a 380px QR); pairing is a dark `.tv-ground` screen with a 96px-high 10% white field (3px 40% white border, turquoise on focus) and a white button with navy text; connecting shows the gear on the dark ground.

### Signature: the no-photo tile
A deterministic brand tile (seeded by exhibitor id) in one of five brand grounds with faint rings, one circle/triangle/dotted-ring accent and the initial in Nexa Black (Latin) or Helvetica Neue Arabic Bold (Arabic initials, the face's top weight). Reads as designed, not as a missing image. The TV scales a 160px tile and removes every yellow from it (`noYellow`): the yellow ground is never picked and a yellow accent becomes white.

### Motion
Entrances use `cubic-bezier(0.25, 1, 0.5, 1)` (quart) or `cubic-bezier(0.16, 1, 0.3, 1)` (expo). Springs: press (stiffness 700, damping 32), soft (380/34), sheet (420/38). Voter and TV animate transform and opacity, except that TV rows also ease height and background and text colour so a place change morphs in place. TV motion: a column rises 24px and fades in over 0.8s (expo), its blocks fade in 80ms apart, rows glide to a new place over 800ms (transform, height, background, colour; expo) while their content fades in after a 150ms delay, a vote nudges the count (scale 1.09), the ceremony curtain slides up over 0.9s (expo) and down over 0.7s, and its beats rise and settle. Reduced motion collapses durations to near zero; on the TV staged delays go to zero and the curtain appears and leaves without a slide. Haptics and sound are enhancements only; the TV has no sound.

### RTL and bidi
Layout is authored with logical properties (`start`/`end`, `ps`/`pe`); arrows, chevrons and the chevron trail flip under RTL (`rtl:-scale-x-100`, `Icon flip`). Digits are Western (Latin) everywhere: `ar-JO-u-nu-latn` for dates, input digits normalised to ASCII. Numbers, phone and times are `.num` (tabular, `direction: ltr`, `unicode-bidi: isolate`) or wrapped in LRI/PDI. Mixed-language names use `dir="auto"` on the voter app and `bdi` / separate `lang`+`dir` spans on the TV so `&`, digits and punctuation never reorder.

## Do's and Don'ts

### Do:
- **Do** put the primary action in the thumb zone as a 56px purple (or on-dark white) button with press scale and haptic.
- **Do** use navy text on yellow and turquoise fills; white on purple, royal and crimson.
- **Do** keep yellow on the TV for first place and the winner only (second light glass, third darker glass, from `SKIN`), and turquoise for liveness only.
- **Do** write every error and refusal so it says what happened and what to do next.
- **Do** fit every TV name to its box by tier (52 down to 21px, ceremony 128 down to 40px) and let it wrap; keep chrome at 40px, counts stepping 96 / 80 / 60px by place (winner 170px); the leader's count carries the visible votes unit and the others carry it for screen readers.
- **Do** keep the TV board dark navy-deep with white type, and make the winner ceremony the brighter brand-navy curtain, opaque, that slides, never fades.
- **Do** let names show in full on every surface: line clamps and truncation are removed from the voter app and the admin console as well as the TV.
- **Do** keep Western digits and isolate numbers inside Arabic text.
- **Do** animate only transform and opacity, with a reduced-motion alternative.
- **Do** use the shared motifs (chevron, dotted gear, rings, triangle, circle) as the only decoration, and the no-photo tile for missing images.

### Don't:
- **Don't** set yellow or turquoise text on white or canvas.
- **Don't** add letter-spacing to Arabic, or use fluid type on the voter app (steps are fixed rem).
- **Don't** introduce new brand hues; extend with tints of the six brand colours only.
- **Don't** use gradient text, confetti, hard offset shadows, or blurred (backdrop-filter) glass; the TV's translucent white blocks are flat fills with a hairline ring, not blur; the anti-references are generic SaaS card grids, government-form density, and casino-style gamification.
- **Don't** show "voted" before the server confirms; the vote sheet says recorded only after success.
- **Don't** let the TV hide or invent numbers: the server decides what is sealed, the client renders it.
- **Don't** truncate or ellipsize a name anywhere (TV, voter app, admin console), or put yellow on the TV anywhere but first place and the winner (including placeholder photo tiles).
- **Don't** use category colours or share bars on the TV, or a gear in the ceremony; titles are white with a white chevron.

### Known inconsistencies in the build (recorded, not canonized)
- The TV board still pages by timer (14s) when there are more than four categories, though the board itself has no rotation or dwell; recorded as built.
- Voter focus ring (3px royal, 6px radius) is global, while fields suppress it and use their own purple ring; both are intended, but the ring colour differs.
