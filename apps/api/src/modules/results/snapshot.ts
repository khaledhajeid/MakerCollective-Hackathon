import { z } from 'zod';

/** How many ranked rows a stored snapshot keeps per category (the TV shows RESULTS_TOP_N of them). */
export const SNAPSHOT_ROWS = 10;

const RowSchema = z.object({ exhibitorId: z.uuid(), votes: z.number().int().nonnegative() });

/** One category's standings at an instant: ids and counts only, so names/photos stay current when edited. */
export const CategoryStandingSchema = z.object({
  categoryId: z.uuid(),
  total: z.number().int().nonnegative(),
  rows: z.array(RowSchema).max(SNAPSHOT_ROWS),
});
export type CategoryStanding = z.infer<typeof CategoryStandingSchema>;

/** `settings.frozen_snapshot` (ADR-003): the whole leaderboard as it was when the Blind Hour began. */
export const FrozenSnapshotSchema = z.object({
  v: z.literal(1),
  takenAt: z.iso.datetime(),
  voters: z.number().int().nonnegative(),
  categories: z.array(CategoryStandingSchema),
});
export type FrozenSnapshot = z.infer<typeof FrozenSnapshotSchema>;

/** One entry of `settings.revealed`: a category announced during REVEAL, with its standings at that moment. */
export const RevealedEntrySchema = CategoryStandingSchema.extend({ revealedAt: z.iso.datetime() });
export type RevealedEntry = z.infer<typeof RevealedEntrySchema>;
export const RevealedSchema = z.array(RevealedEntrySchema);

/**
 * Parse stored JSON defensively. A corrupt value must make the caller fail CLOSED (show nothing), never
 * fall back to live numbers.
 */
export function parseFrozen(value: unknown): FrozenSnapshot | null {
  const r = FrozenSnapshotSchema.safeParse(value);
  return r.success ? r.data : null;
}
export function parseRevealed(value: unknown): RevealedEntry[] | null {
  const r = RevealedSchema.safeParse(value);
  return r.success ? r.data : null;
}
