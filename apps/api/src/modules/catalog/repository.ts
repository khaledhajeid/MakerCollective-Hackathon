import type { CatalogCategory } from '@mc/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { categories, exhibitorCategories, exhibitors } from '../../db/schema.js';

export function photoUrl(photoKey: string | null): string | null {
  return photoKey ? `/uploads/${photoKey}` : null;
}

/**
 * Active categories with their active exhibitors, in one query (no N+1).
 * Categories with no active exhibitors are still returned so the UI can show an empty state.
 */
export async function loadCatalog(db: Database): Promise<CatalogCategory[]> {
  const rows = await db
    .select({ category: categories, exhibitor: exhibitors })
    .from(categories)
    .leftJoin(exhibitorCategories, eq(exhibitorCategories.categoryId, categories.id))
    .leftJoin(
      exhibitors,
      and(eq(exhibitors.id, exhibitorCategories.exhibitorId), eq(exhibitors.isActive, true)),
    )
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.nameEn), asc(exhibitors.nameEn));

  const byId = new Map<string, CatalogCategory>();
  for (const { category: c, exhibitor: e } of rows) {
    let entry = byId.get(c.id);
    if (!entry) {
      entry = {
        id: c.id,
        slug: c.slug,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        descriptionEn: c.descriptionEn,
        descriptionAr: c.descriptionAr,
        color: c.color,
        exhibitors: [],
      };
      byId.set(c.id, entry);
    }
    if (e) {
      entry.exhibitors.push({
        id: e.id,
        nameEn: e.nameEn,
        nameAr: e.nameAr,
        projectEn: e.projectEn,
        projectAr: e.projectAr,
        descriptionEn: e.descriptionEn,
        descriptionAr: e.descriptionAr,
        booth: e.booth,
        photoUrl: photoUrl(e.photoKey),
      });
    }
  }
  return [...byId.values()];
}
