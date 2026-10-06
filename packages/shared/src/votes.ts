import { z } from 'zod';

/** Voting window as the server evaluates it right now (manual override first, then the schedule). */
export const VOTING_STATES = ['OPEN', 'CLOSED', 'NOT_YET_OPEN'] as const;
export type VotingState = (typeof VOTING_STATES)[number];

export const VotingStatusSchema = z.object({
  state: z.enum(VOTING_STATES),
  /** Informational only (countdowns / "opens at …"); the server never trusts a client clock. */
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
});
export type VotingWindowStatus = z.infer<typeof VotingStatusSchema>;

/** Cast a vote. Votes are final (decision #2): the same call can be retried safely, a different choice cannot. */
export const VoteRequestSchema = z.object({
  categoryId: z.uuid(),
  exhibitorId: z.uuid(),
});
export type VoteRequest = z.infer<typeof VoteRequestSchema>;

export const VoteSchema = z.object({
  categoryId: z.uuid(),
  exhibitorId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type Vote = z.infer<typeof VoteSchema>;

export const VoteResponseSchema = z.object({
  vote: VoteSchema,
  /** True when this exact vote already existed (a retry after a dropped connection) — still a success. */
  alreadyRecorded: z.boolean(),
});
export type VoteResponse = z.infer<typeof VoteResponseSchema>;

export const MyVotesSchema = z.object({ votes: z.array(VoteSchema) });
export type MyVotes = z.infer<typeof MyVotesSchema>;
