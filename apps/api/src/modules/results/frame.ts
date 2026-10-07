import {
  RESULTS_TOP_N,
  type CatalogCategory,
  type ResultCategory,
  type ResultExhibitor,
  type ResultsFrame,
} from '@mc/shared';
import type { Settings } from '../settings/repository.js';
import { votingState } from '../votes/window.js';
import { parseFrozen, parseRevealed, type CategoryStanding } from './snapshot.js';
import type { LiveStandings } from './standings.js';

/** Competition ranking (1, 1, 3): everyone level with the leader is a leader. */
function rankRows(
  category: CatalogCategory,
  standing: CategoryStanding | undefined,
): ResultExhibitor[] {
  if (!standing) return [];
  const byId = new Map(category.exhibitors.map((e) => [e.id, e]));
  const visible = standing.rows
    // Only exhibitors that are still active in this category, and only ones with at least one vote.
    .filter((r) => r.votes > 0 && byId.has(r.exhibitorId))
    .slice(0, RESULTS_TOP_N);
  return visible.map((r, i) => {
    const e = byId.get(r.exhibitorId)!;
    const firstTied = visible.findIndex((x) => x.votes === r.votes);
    return {
      id: e.id,
      nameEn: e.nameEn,
      nameAr: e.nameAr,
      booth: e.booth,
      photoUrl: e.photoUrl,
      votes: r.votes,
      rank: (firstTied === -1 ? i : firstTied) + 1,
    };
  });
}

const sealed = (c: CatalogCategory): ResultCategory => ({
  id: c.id,
  slug: c.slug,
  nameEn: c.nameEn,
  nameAr: c.nameAr,
  color: c.color,
  sealed: true,
  total: null,
  exhibitors: [],
});

const open = (c: CatalogCategory, standing: CategoryStanding | undefined): ResultCategory => ({
  ...sealed(c),
  sealed: false,
  total: standing?.total ?? 0,
  exhibitors: rankRows(c, standing),
});

export interface FrameInput {
  settings: Settings;
  catalog: CatalogCategory[];
  /**
   * Reads live counts. It is invoked ONLY in LIVE mode: in every other mode the frame is built from stored
   * snapshots (or nothing), so live numbers are never even loaded while the results are sealed (ADR-003).
   */
  live: () => Promise<LiveStandings>;
  now: Date;
}

/** The single place that decides what a TV may see. Pure apart from the `live` read. */
export async function buildFrame({
  settings,
  catalog,
  live,
  now,
}: FrameInput): Promise<ResultsFrame> {
  const base = {
    mode: settings.resultsVisibility,
    eventName: settings.eventName,
    voting: {
      state: votingState(settings, now),
      opensAt: settings.votingOpensAt?.toISOString() ?? null,
      closesAt: settings.votingClosesAt?.toISOString() ?? null,
    },
    frozenAt: null,
    totalVotes: null,
    voters: null,
    spotlight: null,
  } satisfies Omit<ResultsFrame, 'categories'>;

  switch (settings.resultsVisibility) {
    case 'LIVE': {
      const standings = await live();
      const byId = new Map(standings.categories.map((s) => [s.categoryId, s]));
      const categories = catalog.map((c) => open(c, byId.get(c.id)));
      return {
        ...base,
        totalVotes: categories.reduce((n, c) => n + (c.total ?? 0), 0),
        voters: standings.voters,
        categories,
      };
    }

    case 'FROZEN': {
      const snap = parseFrozen(settings.frozenSnapshot);
      // A missing/corrupt snapshot fails closed: sealed, never "fall back to live".
      if (!snap) return { ...base, categories: catalog.map(sealed) };
      const byId = new Map(snap.categories.map((s) => [s.categoryId, s]));
      // A category created after the freeze has no stored standing: it stays sealed.
      const categories = catalog.map((c) => (byId.has(c.id) ? open(c, byId.get(c.id)) : sealed(c)));
      return {
        ...base,
        frozenAt: settings.frozenAt?.toISOString() ?? snap.takenAt,
        totalVotes: categories.reduce((n, c) => n + (c.total ?? 0), 0),
        voters: snap.voters,
        categories,
      };
    }

    case 'HIDDEN':
      return { ...base, categories: catalog.map(sealed) };

    case 'REVEAL': {
      const entries = parseRevealed(settings.revealed);
      if (!entries) return { ...base, categories: catalog.map(sealed) };
      const byId = new Map(entries.map((e) => [e.categoryId, e]));
      const categories = catalog.map((c) => (byId.has(c.id) ? open(c, byId.get(c.id)) : sealed(c)));
      const last = entries.at(-1);
      const spotlight =
        last && catalog.some((c) => c.id === last.categoryId)
          ? { categoryId: last.categoryId, seq: entries.length }
          : null;
      return { ...base, categories, spotlight };
    }
  }
}
