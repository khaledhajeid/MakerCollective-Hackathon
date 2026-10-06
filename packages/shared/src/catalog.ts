import { z } from 'zod';

/** Public catalog contract (F1). Contains no voter data, so it is safe to cache briefly. */
export const CatalogExhibitorSchema = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  projectEn: z.string().nullable(),
  projectAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  booth: z.string().nullable(),
  photoUrl: z.string().nullable(),
});

export const CatalogCategorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  color: z.string(),
  exhibitors: z.array(CatalogExhibitorSchema),
});

export const CatalogResponseSchema = z.object({
  categories: z.array(CatalogCategorySchema),
});

export type CatalogExhibitor = z.infer<typeof CatalogExhibitorSchema>;
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;
