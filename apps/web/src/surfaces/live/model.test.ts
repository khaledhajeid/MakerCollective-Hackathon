import type { ResultCategory, ResultsFrame } from '@mc/shared';
import { describe, expect, it } from 'vitest';
import {
  barRatio,
  clockTime,
  formatCountdown,
  newReveal,
  nextCategoryId,
  podiumOf,
  revealBaseline,
  screenFor,
} from './model';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cat = (n: number, sealed: boolean, votes = 0): ResultCategory => ({
  id: id(n),
  slug: `c${n}`,
  nameEn: `C${n}`,
  nameAr: `ف${n}`,
  color: '#7f32d9',
  sealed,
  total: sealed ? null : votes,
  exhibitors: sealed
    ? []
    : votes
      ? [
          {
            id: id(100 + n),
            nameEn: 'X',
            nameAr: null,
            booth: null,
            photoUrl: null,
            votes,
            rank: 1,
          },
        ]
      : [],
});
const frame = (patch: Partial<ResultsFrame>): ResultsFrame => ({
  mode: 'LIVE',
  eventName: 'MC',
  voting: { state: 'OPEN', opensAt: null, closesAt: null },
  frozenAt: null,
  totalVotes: 5,
  voters: 5,
  categories: [cat(1, false, 5)],
  spotlight: null,
  ...patch,
});

describe('screenFor', () => {
  it('shows the stage for a live event with votes', () => {
    expect(screenFor(frame({}))).toBe('stage');
  });
  it('waits when nobody has voted yet', () => {
    expect(screenFor(frame({ totalVotes: 0, categories: [cat(1, false, 0)] }))).toBe('waiting');
  });
  it('waits when no categories exist at all', () => {
    expect(screenFor(frame({ categories: [], totalVotes: 0 }))).toBe('waiting');
  });
  it('is sealed in HIDDEN whatever the frame carries', () => {
    expect(screenFor(frame({ mode: 'HIDDEN', totalVotes: null, categories: [cat(1, true)] }))).toBe(
      'sealed',
    );
  });
  it('is sealed in REVEAL until something is announced, then shows the stage', () => {
    const base = { mode: 'REVEAL' as const, totalVotes: null, voters: null };
    expect(screenFor(frame({ ...base, categories: [cat(1, true), cat(2, true)] }))).toBe('sealed');
    expect(screenFor(frame({ ...base, categories: [cat(1, false, 9), cat(2, true)] }))).toBe(
      'stage',
    );
  });
  it('FROZEN with released standings keeps the stage; a zero-vote freeze is not "waiting"', () => {
    expect(
      screenFor(frame({ mode: 'FROZEN', totalVotes: 0, categories: [cat(1, false, 0)] })),
    ).toBe('stage');
  });
});

describe('rotation', () => {
  it('advances and wraps', () => {
    expect(nextCategoryId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextCategoryId(['a', 'b', 'c'], 'c')).toBe('a');
  });
  it('starts at the first when nothing or an unknown category is current', () => {
    expect(nextCategoryId(['a', 'b'], null)).toBe('a');
    expect(nextCategoryId(['a', 'b'], 'gone')).toBe('a');
  });
  it('has no next for an empty list and stays put for a single category', () => {
    expect(nextCategoryId([], null)).toBeNull();
    expect(nextCategoryId(['a'], 'a')).toBe('a');
  });
});

describe('formatting', () => {
  it('counts down as HH:MM:SS and never goes negative', () => {
    expect(formatCountdown(2 * 3600_000 + 14 * 60_000 + 9_000)).toBe('02:14:09');
    expect(formatCountdown(-5000)).toBe('00:00:00');
    expect(formatCountdown(100 * 3600_000)).toBe('100:00:00');
  });
  it('shows event time in Amman with Western digits', () => {
    expect(clockTime('2026-10-08T11:05:00.000Z')).toBe('14:05'); // UTC+3 in October 2026
  });
  it('keeps bar ratios in range', () => {
    expect(barRatio(5, 10)).toBe(0.5);
    expect(barRatio(5, 0)).toBe(0);
    expect(barRatio(20, 10)).toBe(1);
    expect(barRatio(-1, 10)).toBe(0);
  });
});

describe('reveal ceremony trigger', () => {
  const reveal = (seq: number | null) =>
    frame({
      mode: 'REVEAL',
      spotlight: seq === null ? null : { categoryId: id(1), seq },
    });
  it('never plays on the first frame of a connection (reload or reconnect)', () => {
    expect(newReveal(null, reveal(3))).toBeNull();
  });
  it('plays when the reveal count rises while watching', () => {
    expect(newReveal(1, reveal(2))).toEqual({ categoryId: id(1), seq: 2 });
  });
  it('does not replay the same or an older reveal', () => {
    expect(newReveal(2, reveal(2))).toBeNull();
    expect(newReveal(3, reveal(2))).toBeNull();
  });
  it('only plays in REVEAL mode', () => {
    expect(
      newReveal(0, frame({ mode: 'LIVE', spotlight: { categoryId: id(1), seq: 1 } })),
    ).toBeNull();
  });
  it('a second reveal round starts from zero again', () => {
    expect(revealBaseline(frame({ mode: 'LIVE' }))).toBe(0);
    expect(revealBaseline(reveal(4))).toBe(4);
    expect(revealBaseline(reveal(null))).toBe(0);
  });
});

describe('podiumOf', () => {
  const row = (n: number, rank: number, votes: number) => ({
    id: id(n),
    nameEn: `E${n}`,
    nameAr: null,
    booth: null,
    photoUrl: null,
    votes,
    rank,
  });
  it('splits a clear winner from second and third', () => {
    const c = {
      ...cat(1, false, 9),
      exhibitors: [row(1, 1, 9), row(2, 2, 7), row(3, 3, 5), row(4, 4, 2)],
    };
    const p = podiumOf(c);
    expect(p.winners.map((e) => e.id)).toEqual([id(1)]);
    expect(p.runnersUp.map((e) => e.rank)).toEqual([2, 3]);
  });
  it('treats a tie for first as joint winners and skips the missing second place', () => {
    const c = { ...cat(1, false, 9), exhibitors: [row(1, 1, 9), row(2, 1, 9), row(3, 3, 5)] };
    const p = podiumOf(c);
    expect(p.winners).toHaveLength(2);
    expect(p.runnersUp.map((e) => e.rank)).toEqual([3]);
  });
});
