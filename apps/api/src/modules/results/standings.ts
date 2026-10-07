import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { SNAPSHOT_ROWS, type CategoryStanding } from './snapshot.js';

/** Anything that can run a query: the pool-backed database or an open transaction. */
export type Queryable = Pick<Database, 'execute'>;

export interface LiveStandings {
  voters: number;
  categories: CategoryStanding[];
}

interface Row extends Record<string, unknown> {
  category_id: string;
  exhibitor_id: string;
  name_en: string;
  is_active: boolean;
  votes: number;
  voters: number;
}

/**
 * The ONLY place live vote counts are read for display. It is called solely from LIVE mode and from the
 * admin transitions that take a snapshot (freeze / reveal) — see ResultsService. One statement, so the
 * counts and the voter total come from the same snapshot of the database.
 */
export async function liveStandings(db: Queryable): Promise<LiveStandings> {
  const { rows } = await db.execute<Row>(sql`
    SELECT v.category_id, v.exhibitor_id, e.name_en, e.is_active, count(*)::int AS votes,
           (SELECT count(DISTINCT visitor_id) FROM votes)::int AS voters
      FROM votes v
      JOIN exhibitors e ON e.id = v.exhibitor_id
     GROUP BY v.category_id, v.exhibitor_id, e.name_en, e.is_active
  `);

  const byCategory = new Map<string, { total: number; rows: Row[] }>();
  for (const r of rows) {
    const entry = byCategory.get(r.category_id) ?? { total: 0, rows: [] };
    entry.total += r.votes;
    if (r.is_active) entry.rows.push(r);
    byCategory.set(r.category_id, entry);
  }

  const categories: CategoryStanding[] = [...byCategory].map(([categoryId, entry]) => ({
    categoryId,
    total: entry.total,
    rows: entry.rows
      // Deterministic order: votes, then name, then id — a tie never shuffles between two refreshes.
      .sort(
        (a, b) =>
          b.votes - a.votes ||
          a.name_en.localeCompare(b.name_en, 'en') ||
          (a.exhibitor_id < b.exhibitor_id ? -1 : 1),
      )
      .slice(0, SNAPSHOT_ROWS)
      .map((r) => ({ exhibitorId: r.exhibitor_id, votes: r.votes })),
  }));

  return { voters: rows[0]?.voters ?? 0, categories };
}
