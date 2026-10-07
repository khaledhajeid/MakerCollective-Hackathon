import { randomUUID } from 'node:crypto';
import type {
  AdminCategory,
  AdminContent,
  AdminExhibitor,
  CategoryCreate,
  CategoryPatch,
  ExhibitorCreate,
  ExhibitorPatch,
} from '@mc/shared/manage';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database, Tx } from '../../db/client.js';
import {
  categories,
  exhibitorCategories,
  exhibitorPhotos,
  exhibitors,
  votes,
} from '../../db/schema.js';
import { AppError, pgErrorCode } from '../../lib/errors.js';
import type { Actor } from '../results/service.js';
import { changes, writeAudit } from '../admin/audit.js';
import { photoUrl } from '../catalog/repository.js';
import { inspectWebp } from './photo.js';

type CategoryRow = typeof categories.$inferSelect;
type ExhibitorRow = typeof exhibitors.$inferSelect;

const CATEGORY_FIELDS = [
  'nameEn',
  'nameAr',
  'descriptionEn',
  'descriptionAr',
  'color',
  'isActive',
] as const;
const EXHIBITOR_FIELDS = [
  'nameEn',
  'nameAr',
  'projectEn',
  'projectAr',
  'descriptionEn',
  'descriptionAr',
  'booth',
  'isActive',
] as const;

/** A readable, unique, URL-safe handle from the English name. It never changes afterwards (the operator CLI uses it). */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s || 'category';
}

/**
 * Categories, exhibitors and their photos (F2, F3, F9). Everything an organiser changes here is applied and audited
 * in one transaction; the catalog triggers then tell every replica and every TV. Rules the database also enforces
 * (a vote pins its exhibitor and category) are checked first so the organiser gets a sentence, not a constraint name.
 */
export class ContentService {
  constructor(private readonly db: Database) {}

  /* ───────────── reading ───────────── */

  async list(): Promise<AdminContent> {
    const [cats, exs, links, votedCategories, votedExhibitors] = await Promise.all([
      this.db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.nameEn)),
      this.db.select().from(exhibitors).orderBy(asc(exhibitors.nameEn)),
      this.db.select().from(exhibitorCategories),
      this.db.selectDistinct({ id: votes.categoryId }).from(votes),
      this.db.selectDistinct({ id: votes.exhibitorId }).from(votes),
    ]);
    const hasVotesCat = new Set(votedCategories.map((r) => r.id));
    const hasVotesEx = new Set(votedExhibitors.map((r) => r.id));
    const idsByExhibitor = new Map<string, string[]>();
    const countByCategory = new Map<string, number>();
    for (const l of links) {
      const list = idsByExhibitor.get(l.exhibitorId) ?? [];
      list.push(l.categoryId);
      idsByExhibitor.set(l.exhibitorId, list);
      countByCategory.set(l.categoryId, (countByCategory.get(l.categoryId) ?? 0) + 1);
    }
    return {
      categories: cats.map((c) =>
        this.toCategory(c, countByCategory.get(c.id) ?? 0, hasVotesCat.has(c.id)),
      ),
      exhibitors: exs.map((e) =>
        this.toExhibitor(e, idsByExhibitor.get(e.id) ?? [], hasVotesEx.has(e.id)),
      ),
    };
  }

  private toCategory(c: CategoryRow, exhibitorCount: number, hasVotes: boolean): AdminCategory {
    return {
      id: c.id,
      slug: c.slug,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      descriptionEn: c.descriptionEn,
      descriptionAr: c.descriptionAr,
      color: c.color,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      exhibitorCount,
      hasVotes,
    };
  }

  private toExhibitor(e: ExhibitorRow, categoryIds: string[], hasVotes: boolean): AdminExhibitor {
    return {
      id: e.id,
      nameEn: e.nameEn,
      nameAr: e.nameAr,
      projectEn: e.projectEn,
      projectAr: e.projectAr,
      descriptionEn: e.descriptionEn,
      descriptionAr: e.descriptionAr,
      booth: e.booth,
      photoUrl: photoUrl(e.photoKey),
      categoryIds,
      isActive: e.isActive,
      hasVotes,
    };
  }

  private async category(id: string): Promise<AdminCategory> {
    const [row] = await this.db.select().from(categories).where(eq(categories.id, id));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'No such category');
    const exhibitorCount = await this.db.$count(
      exhibitorCategories,
      eq(exhibitorCategories.categoryId, id),
    );
    const hasVotes = (await this.db.$count(votes, eq(votes.categoryId, id))) > 0;
    return this.toCategory(row, exhibitorCount, hasVotes);
  }

  private async exhibitor(id: string): Promise<AdminExhibitor> {
    const [row] = await this.db.select().from(exhibitors).where(eq(exhibitors.id, id));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'No such exhibitor');
    const links = await this.db
      .select({ id: exhibitorCategories.categoryId })
      .from(exhibitorCategories)
      .where(eq(exhibitorCategories.exhibitorId, id));
    const hasVotes = (await this.db.$count(votes, eq(votes.exhibitorId, id))) > 0;
    return this.toExhibitor(
      row,
      links.map((l) => l.id),
      hasVotes,
    );
  }

  /* ───────────── categories ───────────── */

  async createCategory(input: CategoryCreate, actor: Actor): Promise<AdminCategory> {
    const id = await this.write(async (tx) => {
      const base = slugify(input.nameEn);
      const taken = new Set(
        (
          await tx
            .select({ slug: categories.slug })
            .from(categories)
            .where(sql`${categories.slug} = ${base} OR ${categories.slug} LIKE ${`${base}-%`}`)
        ).map((r) => r.slug),
      );
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      const [last] = await tx
        .select({ next: sql<number>`coalesce(max(${categories.sortOrder}), -1) + 1` })
        .from(categories);
      const [row] = await tx
        .insert(categories)
        .values({
          slug,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          color: input.color,
          isActive: input.isActive ?? true,
          sortOrder: Number(last?.next ?? 0),
        })
        .returning({ id: categories.id });
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'category.create',
        entity: 'category',
        entityId: row!.id,
        details: { slug, nameEn: input.nameEn },
        ip: actor.ip,
      });
      return row!.id;
    });
    return this.category(id);
  }

  async updateCategory(id: string, patch: CategoryPatch, actor: Actor): Promise<AdminCategory> {
    await this.write(async (tx) => {
      const [before] = await tx
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .for('update');
      if (!before) throw new AppError(404, 'NOT_FOUND', 'No such category');
      if (Object.keys(patch).length)
        await tx.update(categories).set(patch).where(eq(categories.id, id));
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'category.update',
        entity: 'category',
        entityId: id,
        details: { slug: before.slug, changes: changes(before, patch, CATEGORY_FIELDS) },
        ip: actor.ip,
      });
    });
    return this.category(id);
  }

  async reorderCategories(ids: string[], actor: Actor): Promise<AdminCategory[]> {
    await this.write(async (tx) => {
      const all = await tx.select({ id: categories.id }).from(categories).for('update');
      const known = new Set(all.map((c) => c.id));
      if (
        ids.length !== known.size ||
        new Set(ids).size !== ids.length ||
        ids.some((i) => !known.has(i))
      )
        throw new AppError(409, 'CONFLICT', 'The list of categories changed; reload and try again');
      for (const [position, id] of ids.entries())
        await tx.update(categories).set({ sortOrder: position }).where(eq(categories.id, id));
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'category.reorder',
        entity: 'category',
        details: { order: ids },
        ip: actor.ip,
      });
    });
    return (await this.list()).categories;
  }

  async deleteCategory(id: string, actor: Actor): Promise<void> {
    await this.write(async (tx) => {
      const [row] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such category');
      if ((await tx.$count(votes, eq(votes.categoryId, id))) > 0)
        throw new AppError(
          409,
          'CONFLICT',
          'This category already has votes, so it cannot be deleted. Hide it instead.',
        );
      await tx.delete(categories).where(eq(categories.id, id));
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'category.delete',
        entity: 'category',
        entityId: id,
        details: { slug: row.slug, nameEn: row.nameEn },
        ip: actor.ip,
      });
    });
  }

  /* ───────────── exhibitors ───────────── */

  async createExhibitor(input: ExhibitorCreate, actor: Actor): Promise<AdminExhibitor> {
    const id = await this.write(async (tx) => {
      await this.requireCategories(tx, input.categoryIds);
      const { categoryIds, ...fields } = input;
      const [row] = await tx
        .insert(exhibitors)
        .values({ ...fields, isActive: fields.isActive ?? true })
        .returning({ id: exhibitors.id });
      if (categoryIds.length)
        await tx
          .insert(exhibitorCategories)
          .values(categoryIds.map((categoryId) => ({ exhibitorId: row!.id, categoryId })));
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'exhibitor.create',
        entity: 'exhibitor',
        entityId: row!.id,
        details: { nameEn: input.nameEn, categories: categoryIds.length },
        ip: actor.ip,
      });
      return row!.id;
    });
    return this.exhibitor(id);
  }

  /** Many exhibitors from one spreadsheet: every row is added in one transaction, or none is. One audit entry. */
  async createExhibitors(inputs: ExhibitorCreate[], actor: Actor): Promise<{ created: number }> {
    await this.write(async (tx) => {
      await this.requireCategories(tx, [...new Set(inputs.flatMap((i) => i.categoryIds))]);
      const rows = await tx
        .insert(exhibitors)
        .values(
          inputs.map(({ categoryIds: _categoryIds, ...fields }) => ({
            ...fields,
            isActive: fields.isActive ?? true,
          })),
        )
        .returning({ id: exhibitors.id });
      // `returning` keeps the order of the inserted rows.
      const links = rows.flatMap((row, i) =>
        inputs[i]!.categoryIds.map((categoryId) => ({ exhibitorId: row.id, categoryId })),
      );
      if (links.length) await tx.insert(exhibitorCategories).values(links);
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'exhibitor.bulk_create',
        entity: 'exhibitor',
        details: { count: rows.length },
        ip: actor.ip,
      });
    });
    return { created: inputs.length };
  }

  async updateExhibitor(id: string, patch: ExhibitorPatch, actor: Actor): Promise<AdminExhibitor> {
    await this.write(async (tx) => {
      const [before] = await tx
        .select()
        .from(exhibitors)
        .where(eq(exhibitors.id, id))
        .for('update');
      if (!before) throw new AppError(404, 'NOT_FOUND', 'No such exhibitor');
      const { categoryIds, ...fields } = patch;
      if (Object.keys(fields).length)
        await tx.update(exhibitors).set(fields).where(eq(exhibitors.id, id));

      let categoryChange: { added: number; removed: number } | undefined;
      if (categoryIds) {
        await this.requireCategories(tx, categoryIds);
        const current = (
          await tx
            .select({ id: exhibitorCategories.categoryId })
            .from(exhibitorCategories)
            .where(eq(exhibitorCategories.exhibitorId, id))
        ).map((r) => r.id);
        const next = new Set(categoryIds);
        const removed = current.filter((c) => !next.has(c));
        const added = categoryIds.filter((c) => !current.includes(c));
        if (removed.length) {
          const pinned = await tx
            .selectDistinct({ id: votes.categoryId })
            .from(votes)
            .where(and(eq(votes.exhibitorId, id), inArray(votes.categoryId, removed)));
          if (pinned.length)
            throw new AppError(
              409,
              'CONFLICT',
              'This exhibitor already has votes in a category you removed. Hide the exhibitor instead.',
            );
          await tx
            .delete(exhibitorCategories)
            .where(
              and(
                eq(exhibitorCategories.exhibitorId, id),
                inArray(exhibitorCategories.categoryId, removed),
              ),
            );
        }
        if (added.length)
          await tx
            .insert(exhibitorCategories)
            .values(added.map((categoryId) => ({ exhibitorId: id, categoryId })));
        if (removed.length || added.length)
          categoryChange = { added: added.length, removed: removed.length };
      }
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'exhibitor.update',
        entity: 'exhibitor',
        entityId: id,
        details: {
          nameEn: before.nameEn,
          changes: changes(before, fields, EXHIBITOR_FIELDS),
          ...(categoryChange && { categories: categoryChange }),
        },
        ip: actor.ip,
      });
    });
    return this.exhibitor(id);
  }

  async deleteExhibitor(id: string, actor: Actor): Promise<void> {
    await this.write(async (tx) => {
      const [row] = await tx.select().from(exhibitors).where(eq(exhibitors.id, id)).for('update');
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such exhibitor');
      if ((await tx.$count(votes, eq(votes.exhibitorId, id))) > 0)
        throw new AppError(
          409,
          'CONFLICT',
          'This exhibitor already has votes, so it cannot be deleted. Hide it instead.',
        );
      await tx.delete(exhibitors).where(eq(exhibitors.id, id));
      if (row.photoKey)
        await tx.delete(exhibitorPhotos).where(eq(exhibitorPhotos.key, row.photoKey));
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'exhibitor.delete',
        entity: 'exhibitor',
        entityId: id,
        details: { nameEn: row.nameEn },
        ip: actor.ip,
      });
    });
  }

  private async requireCategories(tx: Tx, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await tx.$count(categories, inArray(categories.id, ids));
    if (found !== ids.length)
      throw new AppError(400, 'VALIDATION_FAILED', 'One of the chosen categories does not exist');
  }

  /* ───────────── photos ───────────── */

  async setPhoto(id: string, bytes: Buffer, actor: Actor): Promise<AdminExhibitor> {
    const info = inspectWebp(bytes);
    const key = `${randomUUID()}.webp`;
    await this.write(async (tx) => {
      const [row] = await tx.select().from(exhibitors).where(eq(exhibitors.id, id)).for('update');
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such exhibitor');
      await tx.insert(exhibitorPhotos).values({ key, data: bytes, ...info });
      await tx.update(exhibitors).set({ photoKey: key }).where(eq(exhibitors.id, id));
      if (row.photoKey)
        await tx.delete(exhibitorPhotos).where(eq(exhibitorPhotos.key, row.photoKey));
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'exhibitor.photo.set',
        entity: 'exhibitor',
        entityId: id,
        details: { nameEn: row.nameEn, ...info, bytes: bytes.length },
        ip: actor.ip,
      });
    });
    return this.exhibitor(id);
  }

  async removePhoto(id: string, actor: Actor): Promise<AdminExhibitor> {
    await this.write(async (tx) => {
      const [row] = await tx.select().from(exhibitors).where(eq(exhibitors.id, id)).for('update');
      if (!row) throw new AppError(404, 'NOT_FOUND', 'No such exhibitor');
      if (!row.photoKey) return;
      await tx.update(exhibitors).set({ photoKey: null }).where(eq(exhibitors.id, id));
      await tx.delete(exhibitorPhotos).where(eq(exhibitorPhotos.key, row.photoKey));
      await writeAudit(tx, {
        adminId: actor.adminId,
        label: actor.label,
        action: 'exhibitor.photo.remove',
        entity: 'exhibitor',
        entityId: id,
        details: { nameEn: row.nameEn },
        ip: actor.ip,
      });
    });
    return this.exhibitor(id);
  }

  /** The bytes behind a public photo URL (served by the photos route). */
  async photo(key: string): Promise<Buffer | null> {
    const [row] = await this.db
      .select({ data: exhibitorPhotos.data })
      .from(exhibitorPhotos)
      .where(eq(exhibitorPhotos.key, key));
    return row?.data ?? null;
  }

  /** Runs a change in a transaction and turns the database's integrity errors into sentences. */
  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(fn);
    } catch (err) {
      switch (pgErrorCode(err)) {
        case '23505':
          throw new AppError(409, 'CONFLICT', 'Someone just created the same thing; try again');
        case '23503':
          throw new AppError(
            409,
            'CONFLICT',
            'That change would break existing votes. Hide it instead of removing it.',
          );
        case '23514':
          throw new AppError(400, 'VALIDATION_FAILED', 'One of the values is out of range');
        default:
          throw err;
      }
    }
  }
}
