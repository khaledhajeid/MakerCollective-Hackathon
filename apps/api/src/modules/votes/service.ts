import type { Vote, VoteRequest } from '@mc/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { categories, exhibitorCategories, exhibitors, votes } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { parseIp } from '../../lib/ip.js';

const toVote = (r: { categoryId: string; exhibitorId: string; createdAt: Date }): Vote => ({
  categoryId: r.categoryId,
  exhibitorId: r.exhibitorId,
  createdAt: r.createdAt.toISOString(),
});

const FK_VIOLATION = '23503';
const sqlState = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
};

export class VoteService {
  constructor(private readonly db: Database) {}

  /**
   * Records one vote. The database is the arbiter of "one vote per category" (UNIQUE visitor+category) and of
   * "this exhibitor competes in this category" (composite FK); this method only turns those outcomes into
   * stable API answers, so a burst of parallel taps or a double-submit can never produce two votes.
   *
   * - first vote            → recorded
   * - same choice again     → `alreadyRecorded` (idempotent retry after a dropped connection)
   * - different choice      → 409 ALREADY_VOTED (votes are final)
   */
  async cast(
    visitorId: string,
    req: VoteRequest,
    clientIp: string | undefined,
  ): Promise<{ vote: Vote; alreadyRecorded: boolean }> {
    const [eligible] = await this.db
      .select({ id: exhibitorCategories.exhibitorId })
      .from(exhibitorCategories)
      .innerJoin(exhibitors, eq(exhibitors.id, exhibitorCategories.exhibitorId))
      .innerJoin(categories, eq(categories.id, exhibitorCategories.categoryId))
      .where(
        and(
          eq(exhibitorCategories.exhibitorId, req.exhibitorId),
          eq(exhibitorCategories.categoryId, req.categoryId),
          eq(exhibitors.isActive, true),
          eq(categories.isActive, true),
        ),
      );
    if (!eligible) {
      throw new AppError(
        422,
        'EXHIBITOR_NOT_IN_CATEGORY',
        'That exhibitor is not in this category',
      );
    }

    let inserted;
    try {
      inserted = await this.db
        .insert(votes)
        .values({
          visitorId,
          categoryId: req.categoryId,
          exhibitorId: req.exhibitorId,
          // Canonical text (an IPv4 client behind a dual-stack socket would otherwise be stored as ::ffff:a.b.c.d).
          clientIp: parseIp(clientIp)?.ip ?? null,
        })
        .onConflictDoNothing({ target: [votes.visitorId, votes.categoryId] })
        .returning();
    } catch (err) {
      // The exhibitor was unlinked from the category between the check above and the insert.
      if (sqlState(err) === FK_VIOLATION) {
        throw new AppError(
          422,
          'EXHIBITOR_NOT_IN_CATEGORY',
          'That exhibitor is not in this category',
        );
      }
      throw err;
    }
    if (inserted[0]) return { vote: toVote(inserted[0]), alreadyRecorded: false };

    // Conflict: this visitor already voted in the category. Votes are immutable, so the row is still there.
    const [existing] = await this.db
      .select()
      .from(votes)
      .where(and(eq(votes.visitorId, visitorId), eq(votes.categoryId, req.categoryId)));
    if (!existing) throw new Error('vote conflict without an existing row'); // impossible: votes are append-only
    if (existing.exhibitorId === req.exhibitorId) {
      return { vote: toVote(existing), alreadyRecorded: true };
    }
    throw new AppError(409, 'ALREADY_VOTED', 'You have already voted in this category', {
      categoryId: existing.categoryId,
      exhibitorId: existing.exhibitorId,
    });
  }

  async listFor(visitorId: string): Promise<Vote[]> {
    const rows = await this.db
      .select()
      .from(votes)
      .where(eq(votes.visitorId, visitorId))
      .orderBy(asc(votes.createdAt));
    return rows.map(toVote);
  }
}
