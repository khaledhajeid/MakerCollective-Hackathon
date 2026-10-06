/**
 * Idempotent development/demo seed: `pnpm --filter @mc/api db:seed`.
 * - Categories are inserted by slug only if missing (safe to re-run; admin edits are kept).
 * - Exhibitors are only inserted into an EMPTY exhibitors table (never duplicates or clobbers
 *   data an admin created).
 * - Only with the explicit `--dev` flag: opens voting and disables the venue IP check so the flow
 *   can be tried from any network. Never inferred from NODE_ENV — a stack run in development
 *   mode at the venue must not silently drop the access control (Phase 1 review, S-8).
 */
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { loadEnv } from '../config/env.js';
import { createDb, type Database } from './client.js';
import { categories, exhibitorCategories, exhibitors, settings } from './schema.js';
import { SEED_CATEGORIES, SEED_EXHIBITORS } from './seed-data.js';

export async function runSeed(db: Database, opts: { devDefaults: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const cats = await tx
      .insert(categories)
      .values(SEED_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
      // Insert-only: never revert names/colours an admin edited after seeding.
      .onConflictDoNothing({ target: categories.slug })
      .returning({ id: categories.id, slug: categories.slug });
    console.log(`categories: ${cats.length} inserted (existing slugs left untouched)`);
    const all = await tx.select({ id: categories.id, slug: categories.slug }).from(categories);
    const idBySlug = new Map(all.map((c) => [c.slug, c.id]));

    const existing = await tx.$count(exhibitors);
    if (existing === 0) {
      for (const { categories: slugs, ...ex } of SEED_EXHIBITORS) {
        const [row] = await tx.insert(exhibitors).values(ex).returning({ id: exhibitors.id });
        await tx
          .insert(exhibitorCategories)
          .values(slugs.map((slug) => ({ exhibitorId: row!.id, categoryId: idBySlug.get(slug)! })));
      }
      console.log(`exhibitors: ${SEED_EXHIBITORS.length} inserted`);
    } else {
      console.log(`exhibitors: ${existing} already present — left untouched`);
    }

    if (opts.devDefaults) {
      await tx.update(settings).set({
        votingStatus: 'OPEN',
        accessMode: 'OFF',
        wifiSsid: 'MC2026',
        wifiPassword: 'makers2026',
        updatedAt: sql`now()`,
      });
      console.warn(
        '⚠ dev seed: voting OPEN and venue IP check OFF — enable IP_ALLOWLIST in admin before the event',
      );
    }
  });
}

// CLI entry: `pnpm --filter @mc/api db:seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = loadEnv();
  const { pool, db } = createDb(env.DATABASE_URL, 2);
  try {
    const dev = process.argv.includes('--dev');
    if (dev && env.NODE_ENV === 'production')
      throw new Error('--dev seed is refused in production');
    await runSeed(db, { devDefaults: dev });
  } finally {
    await pool.end();
  }
}
