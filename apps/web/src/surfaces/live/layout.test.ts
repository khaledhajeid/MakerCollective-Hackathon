import type { ResultCategory, ResultExhibitor } from '@mc/shared';
import { describe, expect, it } from 'vitest';
import {
  COL_H,
  MAX_COLUMNS,
  TIERS,
  boardRows,
  colWidth,
  fitName,
  pagesOf,
  planColumn,
  wrappedLines,
} from './layout';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ex = (
  n: number,
  votes: number,
  rank: number,
  nameEn = `Team ${n}`,
  nameAr: string | null = null,
): ResultExhibitor => ({
  id: id(n),
  nameEn,
  nameAr,
  booth: null,
  photoUrl: null,
  votes,
  rank,
});
const cat = (
  exhibitors: ResultExhibitor[],
  nameEn = 'Category',
  nameAr = 'فئة',
): ResultCategory => ({
  id: id(1),
  slug: 'c',
  nameEn,
  nameAr,
  color: '#7f32d9',
  sealed: false,
  total: exhibitors.reduce((a, e) => a + e.votes, 0),
  exhibitors,
});

describe('wrappedLines', () => {
  it('counts one line for a short name and more for a long one', () => {
    expect(wrappedLines('Plain Name', 40, 500)).toBe(1);
    expect(
      wrappedLines(
        'The Extraordinarily Long Named Autonomous Greenhouse Robotics Collective',
        40,
        500,
      ),
    ).toBeGreaterThan(2);
  });
  it('breaks a single enormous word instead of overflowing', () => {
    expect(wrappedLines('A'.repeat(200), 40, 500)).toBeGreaterThan(5);
  });
  it('is never zero, even for empty text', () => {
    expect(wrappedLines('', 40, 500)).toBeGreaterThanOrEqual(1);
  });
});

describe('fitName', () => {
  it('keeps the largest size when the name fits', () => {
    const f = fitName('أكوا فوغ', 'AquaFog', 500, 200);
    expect(f.tier).toBe(0);
    expect(f.ar).toBe(TIERS[0]![0]);
  });
  it('shrinks a long name step by step until it fits the height', () => {
    const long =
      'The Extraordinarily Long Named Autonomous Greenhouse Robotics Collective of Amman';
    const roomy = fitName(null, long, 330, 600);
    const tight = fitName(null, long, 330, 230);
    expect(tight.tier).toBeGreaterThan(roomy.tier);
    expect(tight.height).toBeLessThanOrEqual(230);
  });
  it('uses the large size for an English-only name', () => {
    const f = fitName(null, 'Plain Name', 500, 200);
    expect(f.ar).toBe(f.en);
    expect(f.arLines).toBe(0);
  });
  it('falls back to the smallest size rather than failing when nothing fits', () => {
    const f = fitName('x '.repeat(200), 'y '.repeat(200), 200, 20);
    expect(f.tier).toBe(TIERS.length - 1);
  });
});

describe('pagesOf', () => {
  it('keeps up to four categories on one screen', () => {
    expect(pagesOf([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(pagesOf(Array.from({ length: MAX_COLUMNS }, (_, i) => i))).toHaveLength(1);
    expect(pagesOf([])).toEqual([]);
  });
  it('pages by three beyond that', () => {
    expect(pagesOf([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });
});

describe('boardRows', () => {
  it('shows the podium, ties included, never more than five', () => {
    const tie = cat(Array.from({ length: 7 }, (_, i) => ex(i + 10, 4, 1)));
    expect(boardRows(tie)).toHaveLength(5);
    expect(boardRows(cat([ex(1, 5, 1), ex(2, 3, 2), ex(3, 2, 3), ex(4, 1, 4)]))).toHaveLength(3);
  });
});

describe('planColumn', () => {
  it('steps the podium down: the single leader gets the tallest row, then second, then third', () => {
    const p = planColumn(cat([ex(1, 5, 1), ex(2, 3, 2), ex(3, 2, 3)]), 3);
    expect(p.rows.map((r) => r.kind)).toEqual(['leader', 'rank', 'rank']);
    expect(p.rows[0]!.height).toBeGreaterThan(p.rows[1]!.height);
    expect(p.rows[1]!.height).toBeGreaterThan(p.rows[2]!.height);
  });
  it('treats co-leaders as equal tied rows, not as three photo bands', () => {
    const p = planColumn(cat([ex(1, 4, 1), ex(2, 4, 1), ex(3, 4, 1)]), 3);
    expect(p.rows.map((r) => r.kind)).toEqual(['tied', 'tied', 'tied']);
    expect(new Set(p.rows.map((r) => r.height)).size).toBe(1);
  });
  it('fills the rest of the podium with open slots', () => {
    const p = planColumn(cat([ex(1, 5, 1)]), 3);
    expect(p.rows).toHaveLength(1);
    expect(p.slots.map((s) => s.rank)).toEqual([2, 3]);
  });
  it('fills the column exactly: head + rows + slots add up to the column height', () => {
    const p = planColumn(cat([ex(1, 5, 1), ex(2, 3, 2)]), 3);
    const last = [...p.rows, ...p.slots].sort((a, b) => a.top - b.top).at(-1)!;
    expect(COL_H - (last.top + last.height)).toBeLessThanOrEqual(2); // rounding only
  });
  it('aligns heads when asked to', () => {
    const short = planColumn(cat([ex(1, 1, 1)]), 3);
    const tall = planColumn(cat([ex(1, 1, 1)]), 3, short.head.height + 60);
    expect(tall.head.height).toBe(short.head.height + 60);
    expect(tall.rows[0]!.top).toBe(tall.head.height);
  });
  it('lets a very long name keep every word (it gets a smaller size, not an ellipsis)', () => {
    const name =
      'The Extraordinarily Long Named Autonomous Greenhouse Robotics Collective of Amman';
    const p = planColumn(cat([ex(1, 5, 1, name), ex(2, 3, 2, name), ex(3, 2, 3, name)]), 3);
    for (const r of p.rows) expect(r.fit.height).toBeLessThanOrEqual(r.height);
  });
  it('shares the width: three columns fit the artboard', () => {
    expect(colWidth(3) * 3 + 2 * 32).toBeCloseTo(1824);
  });
});
