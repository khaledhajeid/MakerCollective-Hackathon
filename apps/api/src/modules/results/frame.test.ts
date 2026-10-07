import type { CatalogCategory } from '@mc/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../settings/repository.js';
import { buildFrame } from './frame.js';
import type { FrozenSnapshot, RevealedEntry } from './snapshot.js';
import type { LiveStandings } from './standings.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ex = (n: number, name: string) => ({
  id: id(n),
  nameEn: name,
  nameAr: null,
  projectEn: null,
  projectAr: null,
  descriptionEn: null,
  descriptionAr: null,
  booth: `B${n}`,
  photoUrl: null,
});
const cat = (
  n: number,
  slug: string,
  exhibitors: CatalogCategory['exhibitors'],
): CatalogCategory => ({
  id: id(n),
  slug,
  nameEn: slug,
  nameAr: slug,
  descriptionEn: null,
  descriptionAr: null,
  color: '#112233',
  exhibitors,
});

const CATALOG = [
  cat(1, 'robots', [ex(11, 'Alpha'), ex(12, 'Beta'), ex(13, 'Gamma')]),
  cat(2, 'apps', [ex(21, 'Delta'), ex(22, 'Echo')]),
];

const settings = (patch: Partial<Settings> = {}): Settings =>
  ({
    eventName: 'MC2026',
    votingStatus: 'OPEN',
    votingOpensAt: null,
    votingClosesAt: null,
    resultsVisibility: 'LIVE',
    frozenSnapshot: null,
    frozenAt: null,
    revealed: [],
    ...patch,
  }) as Settings;

const LIVE_NOW: LiveStandings = {
  voters: 40,
  categories: [
    {
      categoryId: id(1),
      total: 60,
      rows: [
        { exhibitorId: id(12), votes: 30 },
        { exhibitorId: id(11), votes: 20 },
        { exhibitorId: id(13), votes: 10 },
      ],
    },
    { categoryId: id(2), total: 5, rows: [{ exhibitorId: id(21), votes: 5 }] },
  ],
};

const FROZEN: FrozenSnapshot = {
  v: 1,
  takenAt: '2026-10-08T10:00:00.000Z',
  voters: 10,
  categories: [
    {
      categoryId: id(1),
      total: 12,
      rows: [
        { exhibitorId: id(11), votes: 7 },
        { exhibitorId: id(12), votes: 5 },
      ],
    },
    { categoryId: id(2), total: 0, rows: [] },
  ],
};

const run = (s: Settings, live = vi.fn(async () => LIVE_NOW)) =>
  buildFrame({ settings: s, catalog: CATALOG, live, now: new Date('2026-10-08T12:00:00Z') }).then(
    (frame) => ({ frame, live }),
  );

describe('buildFrame — LIVE', () => {
  it('ranks by votes, shares ranks on ties, and totals the event', async () => {
    const tied: LiveStandings = {
      voters: 3,
      categories: [
        {
          categoryId: id(1),
          total: 9,
          rows: [
            { exhibitorId: id(11), votes: 4 },
            { exhibitorId: id(12), votes: 4 },
            { exhibitorId: id(13), votes: 1 },
          ],
        },
      ],
    };
    const { frame } = await run(
      settings(),
      vi.fn(async () => tied),
    );
    const robots = frame.categories[0]!;
    expect(robots.exhibitors.map((e) => [e.nameEn, e.rank])).toEqual([
      ['Alpha', 1],
      ['Beta', 1],
      ['Gamma', 3],
    ]);
    expect(frame.totalVotes).toBe(9);
    expect(frame.voters).toBe(3);
  });

  it('leaves out exhibitors with no votes and ones no longer active in the category', async () => {
    const live: LiveStandings = {
      voters: 1,
      categories: [
        {
          categoryId: id(1),
          total: 3,
          rows: [
            { exhibitorId: id(99), votes: 2 }, // deactivated since
            { exhibitorId: id(11), votes: 1 },
            { exhibitorId: id(12), votes: 0 },
          ],
        },
      ],
    };
    const { frame } = await run(
      settings(),
      vi.fn(async () => live),
    );
    expect(frame.categories[0]!.exhibitors.map((e) => e.nameEn)).toEqual(['Alpha']);
  });

  it('shows an empty, unsealed category rather than failing when nobody has voted', async () => {
    const { frame } = await run(
      settings(),
      vi.fn(async () => ({ voters: 0, categories: [] })),
    );
    expect(frame.categories.map((c) => [c.sealed, c.total, c.exhibitors.length])).toEqual([
      [false, 0, 0],
      [false, 0, 0],
    ]);
    expect(frame.totalVotes).toBe(0);
  });
});

describe('buildFrame — the Blind Hour is enforced here (ADR-003)', () => {
  it('FROZEN serves the stored snapshot and never reads live counts', async () => {
    const { frame, live } = await run(
      settings({
        resultsVisibility: 'FROZEN',
        frozenSnapshot: FROZEN,
        frozenAt: new Date('2026-10-08T10:00:00Z'),
      }),
    );
    expect(live).not.toHaveBeenCalled();
    expect(frame.frozenAt).toBe('2026-10-08T10:00:00.000Z');
    expect(frame.totalVotes).toBe(12);
    expect(frame.voters).toBe(10);
    expect(frame.categories[0]!.exhibitors.map((e) => [e.nameEn, e.votes])).toEqual([
      ['Alpha', 7],
      ['Beta', 5],
    ]);
    // The live leader (Beta, 30) must be nowhere in the payload.
    expect(JSON.stringify(frame)).not.toMatch(/"votes":30|"votes":20/);
  });

  it('FROZEN with a missing or corrupt snapshot fails CLOSED, never to live', async () => {
    for (const bad of [
      null,
      { v: 2 },
      'nonsense',
      { v: 1, takenAt: 'x', voters: -1, categories: [] },
    ]) {
      const { frame, live } = await run(
        settings({ resultsVisibility: 'FROZEN', frozenSnapshot: bad, frozenAt: new Date() }),
      );
      expect(live).not.toHaveBeenCalled();
      expect(
        frame.categories.every((c) => c.sealed && c.total === null && !c.exhibitors.length),
      ).toBe(true);
      expect(frame.totalVotes).toBeNull();
    }
  });

  it('a category created after the freeze stays sealed', async () => {
    const snap: FrozenSnapshot = { ...FROZEN, categories: [FROZEN.categories[0]!] };
    const { frame } = await run(
      settings({ resultsVisibility: 'FROZEN', frozenSnapshot: snap, frozenAt: new Date() }),
    );
    expect(frame.categories.map((c) => c.sealed)).toEqual([false, true]);
  });

  it('HIDDEN sends no standings and no totals at all', async () => {
    const { frame, live } = await run(settings({ resultsVisibility: 'HIDDEN' }));
    expect(live).not.toHaveBeenCalled();
    expect(frame.totalVotes).toBeNull();
    expect(frame.voters).toBeNull();
    expect(
      frame.categories.every((c) => c.sealed && c.exhibitors.length === 0 && c.total === null),
    ).toBe(true);
    expect(JSON.stringify(frame)).not.toMatch(/"votes"/);
  });
});

describe('buildFrame — REVEAL', () => {
  const entry = (
    categoryId: string,
    rows: RevealedEntry['rows'],
    total: number,
  ): RevealedEntry => ({
    categoryId,
    total,
    rows,
    revealedAt: '2026-10-08T11:00:00.000Z',
  });

  it('starts fully sealed with no spotlight', async () => {
    const { frame, live } = await run(settings({ resultsVisibility: 'REVEAL', revealed: [] }));
    expect(live).not.toHaveBeenCalled();
    expect(frame.categories.every((c) => c.sealed)).toBe(true);
    expect(frame.spotlight).toBeNull();
  });

  it('shows only announced categories, from their stored standings, and spotlights the latest', async () => {
    const { frame } = await run(
      settings({
        resultsVisibility: 'REVEAL',
        revealed: [
          entry(id(2), [{ exhibitorId: id(22), votes: 9 }], 9),
          entry(id(1), [{ exhibitorId: id(13), votes: 4 }], 4),
        ],
      }),
    );
    expect(frame.categories.map((c) => c.sealed)).toEqual([false, false]);
    expect(frame.spotlight).toEqual({ categoryId: id(1), seq: 2 });
    expect(frame.categories[1]!.exhibitors[0]).toMatchObject({ nameEn: 'Echo', votes: 9, rank: 1 });
  });

  it('keeps unannounced categories sealed', async () => {
    const { frame } = await run(
      settings({
        resultsVisibility: 'REVEAL',
        revealed: [entry(id(1), [{ exhibitorId: id(11), votes: 3 }], 3)],
      }),
    );
    expect(frame.categories.map((c) => c.sealed)).toEqual([false, true]);
    expect(frame.categories[1]).toMatchObject({ total: null, exhibitors: [] });
  });

  it('a corrupt reveal list fails closed', async () => {
    const { frame } = await run(settings({ resultsVisibility: 'REVEAL', revealed: 'oops' }));
    expect(frame.categories.every((c) => c.sealed)).toBe(true);
    expect(frame.spotlight).toBeNull();
  });
});
