import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { categories, exhibitors, settings } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed.js';
import { SEED_CATEGORIES, SEED_EXHIBITORS } from '../../src/db/seed-data.js';
import { testEnv } from '../helpers.js';
import { openTestDb } from './db.js';

const { pool, db, reset } = openTestDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await reset();
  await runSeed(db, { devDefaults: false });
});

async function getCatalog() {
  const app = await buildApp({ env: testEnv(), db, redis: null });
  return app.inject({ method: 'GET', url: '/api/catalog' });
}

describe('GET /api/catalog (F1)', () => {
  it('returns every active category with its exhibitors, in admin-defined order', async () => {
    const res = await getCatalog();
    expect(res.statusCode).toBe(200);
    const { categories: cats } = res.json();
    expect(cats.map((c: { slug: string }) => c.slug)).toEqual(SEED_CATEGORIES.map((c) => c.slug));
    for (const cat of cats) {
      const expected = SEED_EXHIBITORS.filter((e) => e.categories.includes(cat.slug)).length;
      expect(cat.exhibitors).toHaveLength(expected);
    }
  });

  it('lists a multi-category exhibitor under each of its categories', async () => {
    const { categories: cats } = (await getCatalog()).json();
    const appearances = cats.filter((c: { exhibitors: { nameEn: string }[] }) =>
      c.exhibitors.some((e) => e.nameEn === 'GripForm'),
    );
    expect(appearances).toHaveLength(3);
  });

  it('hides archived exhibitors and inactive categories', async () => {
    await db.update(exhibitors).set({ isActive: false }).where(eq(exhibitors.nameEn, 'GripForm'));
    await db.update(categories).set({ isActive: false }).where(eq(categories.slug, 'best-design'));
    const { categories: cats } = (await getCatalog()).json();
    expect(cats).toHaveLength(SEED_CATEGORIES.length - 1);
    expect(JSON.stringify(cats)).not.toContain('GripForm');
  });

  it('exposes only public fields and a short public cache', async () => {
    const res = await getCatalog();
    expect(res.headers['cache-control']).toContain('public, max-age=10');
    const body = JSON.stringify(res.json());
    for (const forbidden of ['isActive', 'photoKey', 'createdAt', 'phone', 'visitor']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('seed is idempotent: re-running neither duplicates nor clobbers admin edits (code-review #3)', async () => {
    await db
      .update(categories)
      .set({ nameEn: 'Renamed by admin' })
      .where(eq(categories.slug, 'community-choice'));
    await db.update(settings).set({ accessMode: 'IP_ALLOWLIST', votingStatus: 'CLOSED' });
    await runSeed(db, { devDefaults: false });
    const [cat] = await db.select().from(categories).where(eq(categories.slug, 'community-choice'));
    expect(cat!.nameEn).toBe('Renamed by admin');
    const [s] = await db.select().from(settings);
    expect(s).toMatchObject({ accessMode: 'IP_ALLOWLIST', votingStatus: 'CLOSED' });
    expect(await db.$count(categories)).toBe(SEED_CATEGORIES.length);
    expect(await db.$count(exhibitors)).toBe(SEED_EXHIBITORS.length);
  });
});
