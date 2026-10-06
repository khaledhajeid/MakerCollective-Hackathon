import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminUsers,
  auditLog,
  categories,
  exhibitorCategories,
  exhibitors,
  settings,
  visitors,
  votes,
} from '../../src/db/schema.js';
import { openTestDb } from './db.js';

const { pool, db, reset } = openTestDb();
afterAll(() => pool.end());
beforeEach(() => reset());

/** Postgres SQLSTATE of a failed query (drizzle wraps driver errors in `cause`). */
async function sqlState(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? 'unknown';
  }
  return 'no-error';
}

const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

async function category(slug: string) {
  const [row] = await db
    .insert(categories)
    .values({ slug, nameEn: slug, nameAr: slug })
    .returning();
  return row!;
}

async function exhibitor(name: string, categoryIds: string[]) {
  const [row] = await db.insert(exhibitors).values({ nameEn: name }).returning();
  if (categoryIds.length) {
    await db
      .insert(exhibitorCategories)
      .values(categoryIds.map((categoryId) => ({ exhibitorId: row!.id, categoryId })));
  }
  return row!;
}

async function visitor() {
  const [row] = await db
    .insert(visitors)
    .values({
      nameEnc: 'v1.x',
      phoneEnc: 'v1.y',
      phoneHash: randomBytes(32).toString('hex'),
      voteConsentAt: new Date(),
      consentVersion: 'test',
    })
    .returning();
  return row!;
}

describe('F2/F12 — one vote per visitor per category', () => {
  it('accepts one vote per category, across several categories', async () => {
    const [a, b] = [await category('a'), await category('b')];
    const ex = await exhibitor('X', [a.id, b.id]);
    const v = await visitor();
    await db.insert(votes).values({ visitorId: v.id, categoryId: a.id, exhibitorId: ex.id });
    await db.insert(votes).values({ visitorId: v.id, categoryId: b.id, exhibitorId: ex.id });
    expect(await db.$count(votes)).toBe(2);
  });

  it('rejects a second vote in the same category, even for a different exhibitor', async () => {
    const c = await category('c');
    const [x, y] = [await exhibitor('X', [c.id]), await exhibitor('Y', [c.id])];
    const v = await visitor();
    await db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: x.id });
    expect(
      await sqlState(
        db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: y.id }),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it('holds under a concurrent burst: 20 parallel attempts → exactly 1 vote', async () => {
    const c = await category('race');
    const exs = await Promise.all(Array.from({ length: 4 }, (_, i) => exhibitor(`E${i}`, [c.id])));
    const v = await visitor();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: exs[i % 4]!.id }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.$count(votes, eq(votes.visitorId, v.id))).toBe(1);
  });

  it('rejects a duplicate phone identity (one visitor per phone hash)', async () => {
    const hash = randomBytes(32).toString('hex');
    const row = {
      nameEnc: 'a',
      phoneEnc: 'b',
      phoneHash: hash,
      voteConsentAt: new Date(),
      consentVersion: 't',
    };
    await db.insert(visitors).values(row);
    expect(await sqlState(db.insert(visitors).values(row))).toBe(UNIQUE_VIOLATION);
  });
});

describe('vote validity', () => {
  it('rejects a vote for an exhibitor that is not in that category', async () => {
    const [a, b] = [await category('a'), await category('b')];
    const onlyInA = await exhibitor('X', [a.id]);
    const v = await visitor();
    expect(
      await sqlState(
        db.insert(votes).values({ visitorId: v.id, categoryId: b.id, exhibitorId: onlyInA.id }),
      ),
    ).toBe(FK_VIOLATION);
  });

  it('rejects votes for unknown categories/exhibitors/visitors', async () => {
    const c = await category('c');
    const ex = await exhibitor('X', [c.id]);
    expect(
      await sqlState(
        db.insert(votes).values({ visitorId: randomUUID(), categoryId: c.id, exhibitorId: ex.id }),
      ),
    ).toBe(FK_VIOLATION);
  });
});

describe('votes are final (decision #2)', () => {
  it('blocks UPDATE of any vote', async () => {
    const c = await category('c');
    const [x, y] = [await exhibitor('X', [c.id]), await exhibitor('Y', [c.id])];
    const v = await visitor();
    await db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: x.id });
    expect(await sqlState(db.update(votes).set({ exhibitorId: y.id }))).toBe(CHECK_VIOLATION);
  });

  it('blocks DELETE and TRUNCATE outside an authorised reset', async () => {
    const c = await category('c');
    const ex = await exhibitor('X', [c.id]);
    const v = await visitor();
    await db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: ex.id });
    expect(await sqlState(db.delete(votes))).toBe(CHECK_VIOLATION);
    expect(await sqlState(db.execute(sql`TRUNCATE votes`))).toBe(CHECK_VIOLATION);
    expect(await db.$count(votes)).toBe(1);
  });

  it('allows deletion only inside a transaction that opts in to a results reset', async () => {
    const c = await category('c');
    const ex = await exhibitor('X', [c.id]);
    const v = await visitor();
    await db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: ex.id });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL mc.allow_vote_reset = 'on'`);
      await tx.delete(votes);
    });
    expect(await db.$count(votes)).toBe(0);
    // The flag is transaction-scoped: it does not leak to later statements.
    await db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: ex.id });
    expect(await sqlState(db.delete(votes))).toBe(CHECK_VIOLATION);
  });

  it('prevents deleting an exhibitor that has votes (archive with is_active instead)', async () => {
    const c = await category('c');
    const ex = await exhibitor('X', [c.id]);
    const v = await visitor();
    await db.insert(votes).values({ visitorId: v.id, categoryId: c.id, exhibitorId: ex.id });
    expect(await sqlState(db.delete(exhibitors).where(eq(exhibitors.id, ex.id)))).toBe(
      FK_VIOLATION,
    );
    expect(await sqlState(db.delete(categories).where(eq(categories.id, c.id)))).toBe(FK_VIOLATION);
  });

  it('allows deleting an exhibitor without votes (cascades its category links)', async () => {
    const c = await category('c');
    const ex = await exhibitor('X', [c.id]);
    await db.delete(exhibitors).where(eq(exhibitors.id, ex.id));
    expect(await db.$count(exhibitorCategories)).toBe(0);
  });
});

describe('audit log is append-only', () => {
  it('accepts inserts but blocks UPDATE, DELETE and TRUNCATE', async () => {
    await db.insert(auditLog).values({ actorLabel: 'test', action: 'TEST' });
    expect(await sqlState(db.update(auditLog).set({ action: 'TAMPERED' }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(db.delete(auditLog))).toBe(CHECK_VIOLATION);
    expect(await sqlState(db.execute(sql`TRUNCATE audit_log`))).toBe(CHECK_VIOLATION);
    expect(await db.$count(auditLog)).toBe(1);
  });
});

describe('admin offboarding keeps the audit trail intact (code-review #1)', () => {
  it('refuses to delete an admin who has audit history; disabling works instead', async () => {
    const [admin] = await db
      .insert(adminUsers)
      .values({ username: 'ops.lead', passwordHash: 'x' })
      .returning();
    await db
      .insert(auditLog)
      .values({ actorAdminId: admin!.id, actorLabel: 'ops.lead', action: 'LOGIN' });
    expect(await sqlState(db.delete(adminUsers).where(eq(adminUsers.id, admin!.id)))).toBe(
      FK_VIOLATION,
    );
    await db.update(adminUsers).set({ isDisabled: true }).where(eq(adminUsers.id, admin!.id));
    const [entry] = await db.select().from(auditLog);
    expect(entry!.actorAdminId).toBe(admin!.id);
  });
});

describe('timestamps (code-review #10)', () => {
  it('maintains updated_at automatically on update', async () => {
    const c = await category('ts');
    await new Promise((r) => setTimeout(r, 20));
    const [updated] = await db
      .update(categories)
      .set({ nameEn: 'renamed' })
      .where(eq(categories.id, c.id))
      .returning();
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(c.updatedAt.getTime());
  });
});

describe('settings integrity', () => {
  it('is a singleton created by the migration', async () => {
    expect(await db.$count(settings)).toBe(1);
    expect(await sqlState(db.insert(settings).values({ id: 2 }))).toBe(CHECK_VIOLATION);
  });

  it('defaults to a secure posture: IP allow-list on, LIVE visibility, Jordan mobiles only', async () => {
    const [s] = await db.select().from(settings);
    expect(s).toMatchObject({
      accessMode: 'IP_ALLOWLIST',
      resultsVisibility: 'LIVE',
      allowedPhonePrefixes: ['+9627'],
    });
  });

  it('validates venue ranges in the database (cidr type)', async () => {
    await db.update(settings).set({ venueCidrs: ['203.0.113.0/24', '198.51.100.7/32'] });
    expect(await sqlState(db.update(settings).set({ venueCidrs: ['not-an-ip'] }))).toBe('22P02');
    expect(await sqlState(db.update(settings).set({ venueCidrs: ['10.0.0.1/24'] }))).toBe('22P02'); // host bits set
  });

  it('rejects an inverted voting window and an inconsistent freeze', async () => {
    const now = Date.now();
    expect(
      await sqlState(
        db
          .update(settings)
          .set({ votingOpensAt: new Date(now), votingClosesAt: new Date(now - 1000) }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(await sqlState(db.update(settings).set({ resultsVisibility: 'FROZEN' }))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('rejects unsafe OTP policy values', async () => {
    expect(await sqlState(db.update(settings).set({ otpMaxAttempts: 1000 }))).toBe(CHECK_VIOLATION);
    expect(await sqlState(db.update(settings).set({ otpTtlSeconds: 86_400 }))).toBe(
      CHECK_VIOLATION,
    );
  });
});

describe('catalog field validation', () => {
  it('rejects malformed slugs, colours and client-chosen photo paths', async () => {
    expect(
      await sqlState(db.insert(categories).values({ slug: 'Bad Slug!', nameEn: 'x', nameAr: 'x' })),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        db.insert(categories).values({ slug: 'ok', nameEn: 'x', nameAr: 'x', color: 'red;}' }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(db.insert(exhibitors).values({ nameEn: 'x', photoKey: '../../etc/passwd' })),
    ).toBe(CHECK_VIOLATION);
  });
});
