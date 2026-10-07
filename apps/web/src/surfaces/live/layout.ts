import type { ResultCategory, ResultExhibitor } from '@mc/shared';

/*
 * Geometry of the board, in design pixels on the 1920x1080 artboard.
 *
 * Names are NEVER truncated. Instead of clipping a long name with an ellipsis, every name is given the largest size
 * at which it fits its box in full (wrapping onto further lines), and shrinks step by step for the longest ones.
 * The estimate below is pure arithmetic on the text, so the board needs no DOM measuring and re-renders cheaply;
 * it errs on the wide side, and the browser tests check that nothing overflows with real fonts.
 */

export const FRAME_W = 1824; // 1920 - 2 x 48 side padding
export const COL_GAP = 32;
export const COL_H = 720;
/** A column holds at most this many categories side by side; more are shown in pages. */
export const MAX_COLUMNS = 4;
/** Placeholder rows keep the podium shape until three exhibitors have votes. */
export const PODIUM = 3;
/** Ties can put more than three exhibitors on the podium; the column never shows more than this. */
export const MAX_ROWS = 5;

/** [Arabic size, English size] pairs, largest first. The same step is used for both lines of one name. */
export type Tier = readonly [ar: number, en: number];
export const TIERS: readonly Tier[] = [
  [52, 42],
  [48, 40],
  [44, 38],
  [40, 35],
  [36, 32],
  [32, 29],
  [28, 26],
  [24, 22],
  [21, 20],
];

/** The winner ceremony reads from further away: the same idea at poster scale. */
export const CEREMONY_TIERS: readonly Tier[] = [
  [128, 64],
  [104, 56],
  [88, 52],
  [76, 48],
  [64, 44],
  [56, 40],
  [48, 36],
  [40, 32],
];

const AR_EM = 0.58; // Helvetica Neue Arabic Bold: average advance per character, in em
const EN_EM = 0.62; // Nexa: a wide geometric face
const AR_LEAD = 1.32;
const EN_LEAD = 1.2;
const LINE_GAP = 6;

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

/** How many lines `text` needs at `size` px in a box `width` px wide (greedy word wrap, words never split unless huge). */
export function wrappedLines(text: string, size: number, width: number): number {
  const em = isArabic(text) ? AR_EM : EN_EM;
  const perLine = Math.max(1, Math.floor(width / (size * em)));
  let lines = 1;
  let used = 0;
  for (const word of text.trim().split(/\s+/)) {
    const len = [...word].length;
    if (len > perLine) {
      // A single word longer than a line breaks anywhere (the CSS has overflow-wrap: anywhere).
      if (used > 0) lines += 1;
      lines += Math.ceil(len / perLine) - 1;
      used = len % perLine || perLine;
      continue;
    }
    if (used === 0) used = len;
    else if (used + 1 + len <= perLine) used += 1 + len;
    else {
      lines += 1;
      used = len;
    }
  }
  return lines;
}

export interface NameFit {
  tier: number;
  /** Arabic line size, or the only line's size when the exhibitor has no Arabic name. */
  ar: number;
  en: number;
  arLines: number;
  enLines: number;
  /** Estimated height of the whole name block. */
  height: number;
}

/** The largest tier at which both lines of a name fit `width` x `maxHeight`; the smallest tier when none does. */
export function fitName(
  nameAr: string | null,
  nameEn: string,
  width: number,
  maxHeight: number,
  tiers: readonly Tier[] = TIERS,
): NameFit {
  let last: NameFit | null = null;
  for (let tier = 0; tier < tiers.length; tier++) {
    const [arSize, enSize] = tiers[tier]!;
    let fit: NameFit;
    if (nameAr) {
      const arLines = wrappedLines(nameAr, arSize, width);
      const enLines = wrappedLines(nameEn, enSize, width);
      fit = {
        tier,
        ar: arSize,
        en: enSize,
        arLines,
        enLines,
        height: Math.ceil(arLines * arSize * AR_LEAD + enLines * enSize * EN_LEAD + LINE_GAP),
      };
    } else {
      // English only: it takes the large (primary) size.
      const enLines = wrappedLines(nameEn, arSize, width);
      fit = {
        tier,
        ar: arSize,
        en: arSize,
        arLines: 0,
        enLines,
        height: Math.ceil(enLines * arSize * EN_LEAD),
      };
    }
    last = fit;
    if (fit.height <= maxHeight) return fit;
  }
  return last!;
}

export const colWidth = (columns: number) => (FRAME_W - (columns - 1) * COL_GAP) / columns;

/** The exhibitors a column shows: everyone on the podium (ties included), never more than MAX_ROWS. */
export const boardRows = (c: ResultCategory): ResultExhibitor[] =>
  c.exhibitors.filter((e) => e.rank <= PODIUM).slice(0, MAX_ROWS);

/** Categories per screen: all of them up to MAX_COLUMNS, otherwise pages of three. */
export function pagesOf<T>(items: readonly T[]): T[][] {
  if (items.length <= MAX_COLUMNS) return items.length ? [[...items]] : [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += 3) pages.push(items.slice(i, i + 3));
  return pages;
}

const PAD_X = 26;
const HEAD_PAD_Y = 12;
const HEAD_MIN = 108;
/** Podium blocks are separate, with a clear gap, so each place reads as its own step. */
const ROW_GAP = 14;
/** The category title is quieter than any name on the podium: it starts two steps below the largest size. */
const HEAD_TIERS = TIERS.slice(2);
const ROW_PAD_Y = 14;
/** The podium steps down in size: first is the tallest, third the shortest. */
const weightOf = (rank: number, solo: boolean) =>
  rank === 1 ? (solo ? 1.8 : 1) : rank === 2 ? 1.2 : 0.95;
/** Names may be set at most this large per place, so the step from first to third is visible in the type too. */
const TIER_FLOOR = { 1: 0, 2: 1, 3: 2 } as const;
const tiersFor = (rank: number) => TIERS.slice(TIER_FLOOR[rank <= 1 ? 1 : rank === 2 ? 2 : 3]);
/** Leader band: photo and count share the top line. */
const LEADER_TOP = 112;
const LEADER_PHOTO = 104;
/** Rank rows: rank number, name block, count share one line. */
const RANK_W = 68;
const COUNT_GAP = 18;
const COUNT_SIZE = 64;
const DIGIT_EM = 0.78; // Nexa Black digits are wide

/** A vote count with its small unit beneath: as wide as the larger of the two. */
const UNIT_W = 64;
export const countWidth = (votes: number, size: number) =>
  Math.max(UNIT_W, Math.ceil(votes.toLocaleString('en-US').length * size * DIGIT_EM * 0.9));

export interface RowPlan {
  ex: ResultExhibitor;
  /** `leader`: the one exhibitor in front (photo band). `tied`: one of several sharing first place (a yellow row). */
  kind: 'leader' | 'tied' | 'rank';
  top: number;
  height: number;
  fit: NameFit;
}
export interface SlotPlan {
  rank: number;
  top: number;
  height: number;
}
export interface ColumnPlan {
  head: { fit: NameFit; height: number; width: number };
  rows: RowPlan[];
  slots: SlotPlan[];
  width: number;
}

/** Where everything in one category's column goes, and how large each name can be. */
export function planColumn(c: ResultCategory, columns: number, minHead = 0): ColumnPlan {
  const width = colWidth(columns);
  const inner = width - PAD_X * 2;
  const chevron = 40;
  const headWidth = inner - chevron - 16;
  const headFit = fitName(c.nameAr, c.nameEn, headWidth, 160, HEAD_TIERS);
  const headH = Math.max(minHead, HEAD_MIN, headFit.height + HEAD_PAD_Y * 2);

  const exhibitors = boardRows(c);
  const solo = exhibitors.filter((e) => e.rank === 1).length <= 1;
  const slotsNeeded = Math.max(0, PODIUM - exhibitors.length);
  const weights = [
    ...exhibitors.map((e) => weightOf(e.rank, solo)),
    // An open slot is as tall as the place it stands for, so every column's podium lines up with its neighbours.
    ...Array.from({ length: slotsNeeded }, (_, k) => weightOf(exhibitors.length + k + 1, solo)),
  ];
  const bodyH = COL_H - headH - ROW_GAP * Math.max(0, weights.length - 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let top = headH;
  const rows: RowPlan[] = [];
  const slots: SlotPlan[] = [];
  weights.forEach((w, i) => {
    const height = Math.floor((bodyH * w) / total);
    const ex = exhibitors[i];
    if (ex) {
      const leader = ex.rank === 1 && solo;
      const nameBox = leader
        ? { w: inner, h: height - LEADER_TOP - ROW_PAD_Y * 2 }
        : {
            w: inner - RANK_W - countWidth(ex.votes, COUNT_SIZE) - COUNT_GAP * 2,
            h: height - ROW_PAD_Y * 2,
          };
      rows.push({
        ex,
        kind: leader ? 'leader' : ex.rank === 1 ? 'tied' : 'rank',
        top,
        height,
        fit: fitName(
          ex.nameAr,
          ex.nameEn,
          nameBox.w,
          nameBox.h,
          leader ? TIERS : tiersFor(ex.rank),
        ),
      });
    } else {
      slots.push({ rank: i + 1, top, height });
    }
    top += height + ROW_GAP;
  });
  return { head: { fit: headFit, height: headH, width: headWidth }, rows, slots, width };
}

export const ROW = {
  ROW_GAP,
  PAD_X,
  ROW_PAD_Y,
  LEADER_TOP,
  LEADER_PHOTO,
  RANK_W,
  COUNT_GAP,
  COUNT_SIZE,
};
