import { z } from 'zod';
import { RESULTS_VISIBILITY } from './constants.js';
import { VotingStatusSchema } from './votes.js';

/** Standings shown per category on a TV (the API never sends more: less data, nothing to leak). */
export const RESULTS_TOP_N = 5;

export const ResultExhibitorSchema = z.object({
  id: z.uuid(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  booth: z.string().nullable(),
  photoUrl: z.string().nullable(),
  votes: z.number().int().nonnegative(),
  /** Competition rank computed by the server: ties share a rank (1, 1, 3). Rank 1 = leader(s). */
  rank: z.number().int().positive(),
});

export const ResultCategorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  color: z.string(),
  /** True when the server withholds this category's standings (Blind Hour hidden / not yet revealed). */
  sealed: z.boolean(),
  /** Votes cast in this category; null while sealed. */
  total: z.number().int().nonnegative().nullable(),
  exhibitors: z.array(ResultExhibitorSchema),
});

/**
 * What a TV receives. The server alone decides what is in it (ADR-003): in FROZEN the numbers are the stored
 * snapshot, in HIDDEN/REVEAL-unrevealed they are absent. The browser is never trusted to hide anything.
 */
export const ResultsFrameSchema = z.object({
  mode: z.enum(RESULTS_VISIBILITY),
  eventName: z.string(),
  voting: VotingStatusSchema,
  /** FROZEN only: when the standings were sealed. */
  frozenAt: z.iso.datetime().nullable(),
  /** Votes cast / people who voted; null while sealed. */
  totalVotes: z.number().int().nonnegative().nullable(),
  voters: z.number().int().nonnegative().nullable(),
  categories: z.array(ResultCategorySchema),
  /** REVEAL only: the category announced most recently. `seq` rises with every reveal so a TV animates once. */
  spotlight: z.object({ categoryId: z.uuid(), seq: z.number().int().positive() }).nullable(),
});

export type ResultExhibitor = z.infer<typeof ResultExhibitorSchema>;
export type ResultCategory = z.infer<typeof ResultCategorySchema>;
export type ResultsFrame = z.infer<typeof ResultsFrameSchema>;

/** Pairing a TV: the display token travels once, in a POST body, and is then held in an HttpOnly cookie. */
export const DisplayPairRequestSchema = z.object({
  token: z.string().trim().min(20).max(80),
});
export const DisplaySessionSchema = z.object({ label: z.string() });
export type DisplaySession = z.infer<typeof DisplaySessionSchema>;

/** Server-sent heartbeat: lets a TV with a wrong clock keep its countdown right. */
export const DisplayTimeSchema = z.object({ serverTime: z.iso.datetime() });
