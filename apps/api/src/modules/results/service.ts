import type { ResultsFrame, ResultsVisibility } from '@mc/shared';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { auditLog, categories, settings } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { loadCatalog } from '../catalog/repository.js';
import { loadSettings, type Settings } from '../settings/repository.js';
import { buildFrame } from './frame.js';
import { parseRevealed, type FrozenSnapshot, type RevealedEntry } from './snapshot.js';
import { liveStandings } from './standings.js';

/** Who is acting: an admin (Phase 5/6) or the operator CLI. Recorded in the append-only audit log. */
export interface Actor {
  adminId: string | null;
  label: string;
  ip?: string | null;
}

export interface ModeChange {
  mode: ResultsVisibility;
  /** False when the requested mode was already active (the call is idempotent). */
  changed: boolean;
}

/**
 * Blind Hour / reveal state machine (ADR-003). Everything a TV may see is decided here and in `buildFrame`;
 * the HTTP layer only transports frames.
 *
 *   LIVE ⇄ FROZEN ⇄ HIDDEN        any → REVEAL (starts empty) → reveal categories one by one
 *
 * - Entering FROZEN stores the leaderboard at that instant (`frozen_snapshot`). Re-entering FROZEN while
 *   already frozen keeps the ORIGINAL snapshot (a double click must not "refresh" a sealed result).
 * - Entering REVEAL clears the previous snapshot: nothing is shown until a category is revealed, and each
 *   reveal stores that category's standings at that moment, so a late vote cannot change an announced winner.
 * - Every transition runs in one transaction under a row lock on `settings` and is audit-logged; the settings
 *   trigger then notifies every replica, so all TVs switch within the hub's coalescing window (≤ 1 s).
 */
export class ResultsService {
  constructor(private readonly db: Database) {}

  /**
   * The frame a TV gets right now, from a fresh read of the database (never the 2 s settings cache).
   * One REPEATABLE READ snapshot covers the mode and the votes, so a freeze that commits mid-read can never
   * leave a frame that pairs "LIVE" with counts newer than the sealed snapshot.
   */
  async frame(now: Date = new Date()): Promise<ResultsFrame> {
    return this.db.transaction(
      async (tx) => {
        const s = await loadSettings(tx);
        const catalog = await loadCatalog(tx);
        return buildFrame({ settings: s, catalog, live: () => liveStandings(tx), now });
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async setMode(target: ResultsVisibility, actor: Actor): Promise<ModeChange> {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update');
      if (!cur) throw new Error('settings row missing — run migrations');
      if (cur.resultsVisibility === target) return { mode: target, changed: false };

      const now = new Date();
      let patch: Partial<typeof settings.$inferInsert>;
      if (target === 'FROZEN') {
        const live = await liveStandings(tx);
        // Record EVERY active category, including ones with no votes yet: a category missing from the snapshot
        // means "created after the freeze" and stays sealed, which is not what an empty category should show.
        const active = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.isActive, true));
        const counted = new Map(live.categories.map((c) => [c.categoryId, c]));
        const snapshot: FrozenSnapshot = {
          v: 1,
          takenAt: now.toISOString(),
          voters: live.voters,
          categories: active.map(
            (c) => counted.get(c.id) ?? { categoryId: c.id, total: 0, rows: [] },
          ),
        };
        patch = { frozenSnapshot: snapshot, frozenAt: now, revealed: [] };
      } else {
        // LIVE, HIDDEN and a fresh REVEAL all start with nothing stored.
        patch = { frozenSnapshot: null, frozenAt: null, revealed: [] };
      }

      await tx
        .update(settings)
        .set({
          ...patch,
          resultsVisibility: target,
          version: sql`${settings.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(settings.id, 1));
      await tx.insert(auditLog).values({
        actorAdminId: actor.adminId,
        actorLabel: actor.label,
        action: 'results.mode',
        entity: 'settings',
        entityId: '1',
        details: { from: cur.resultsVisibility, to: target },
        ip: actor.ip ?? null,
      });
      return { mode: target, changed: true };
    });
  }

  /** Announce one category (REVEAL mode only). Idempotent: revealing it twice changes nothing. */
  async revealCategory(
    ref: { categoryId: string } | { slug: string },
    actor: Actor,
  ): Promise<{ categoryId: string; changed: boolean }> {
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update');
      if (!cur) throw new Error('settings row missing — run migrations');
      if (cur.resultsVisibility !== 'REVEAL')
        throw new AppError(409, 'CONFLICT', 'Categories can only be revealed in REVEAL mode');

      const [category] = await tx
        .select({ id: categories.id, isActive: categories.isActive })
        .from(categories)
        .where(
          'categoryId' in ref ? eq(categories.id, ref.categoryId) : eq(categories.slug, ref.slug),
        );
      if (!category?.isActive) throw new AppError(404, 'NOT_FOUND', 'Category not found');

      const revealed = parseRevealed(cur.revealed);
      if (!revealed) throw new Error('settings.revealed is corrupt');
      if (revealed.some((e) => e.categoryId === category.id))
        return { categoryId: category.id, changed: false };

      const live = await liveStandings(tx);
      const standing = live.categories.find((c) => c.categoryId === category.id) ?? {
        categoryId: category.id,
        total: 0,
        rows: [],
      };
      const entry: RevealedEntry = { ...standing, revealedAt: new Date().toISOString() };

      await tx
        .update(settings)
        .set({
          revealed: [...revealed, entry],
          version: sql`${settings.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(settings.id, 1));
      await tx.insert(auditLog).values({
        actorAdminId: actor.adminId,
        actorLabel: actor.label,
        action: 'results.reveal',
        entity: 'category',
        entityId: category.id,
        details: { seq: revealed.length + 1 },
        ip: actor.ip ?? null,
      });
      return { categoryId: category.id, changed: true };
    });
  }

  async current(): Promise<Settings> {
    return loadSettings(this.db);
  }
}
