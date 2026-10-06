import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import {
  MyVotesSchema,
  VoteRequestSchema,
  VoteResponseSchema,
  VotingStatusSchema,
} from '@mc/shared';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { venueGuard } from '../access/guard.js';
import { readSession } from '../auth/session.js';
import { votingState } from './window.js';

export const voteRoutes: FastifyPluginAsyncZod = async (app) => {
  /** The signed-in, non-blocked, non-revoked visitor behind this request, or a 401. */
  const currentVisitor = async (request: FastifyRequest) => {
    const session = readSession(request);
    const visitor = session ? await app.auth.visitorForSession(session) : null;
    if (!visitor) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to vote');
    return visitor;
  };

  /** Public: lets the welcome screen say "opens at…" / "closed" before anyone signs in. */
  app.get(
    '/voting/status',
    { schema: { response: { 200: VotingStatusSchema } } },
    async (_req, reply) => {
      const s = await app.settings.get();
      reply.header('cache-control', 'no-store');
      return {
        state: votingState(s),
        opensAt: s.votingOpensAt?.toISOString() ?? null,
        closesAt: s.votingClosesAt?.toISOString() ?? null,
      };
    },
  );

  app.post(
    '/votes',
    {
      // Order matters: network first (so an outsider is told to join the Wi-Fi), then identity, then the window.
      preHandler: venueGuard(app),
      schema: { body: VoteRequestSchema, response: { 200: VoteResponseSchema } },
    },
    async (request) => {
      const visitor = await currentVisitor(request);
      // A person casts at most one vote per category, so this only ever trips on a runaway client.
      const hit = await app.limiter.hit('vote', visitor.id, 60, 60);
      if (!hit.allowed) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many attempts, please wait', {
          retryAfterSeconds: hit.retryAfterSec,
        });
      }
      const settings = await app.settings.get();
      const state = votingState(settings);
      if (state !== 'OPEN') {
        throw new AppError(403, 'VOTING_NOT_OPEN', 'Voting is not open', {
          state,
          opensAt: settings.votingOpensAt?.toISOString() ?? null,
          closesAt: settings.votingClosesAt?.toISOString() ?? null,
        });
      }
      return app.votes.cast(visitor.id, request.body, request.ip);
    },
  );

  /** The caller's own votes (drives the ✓ / ○ state on the hub). Private to the signed-in visitor. */
  app.get('/me/votes', { schema: { response: { 200: MyVotesSchema } } }, async (request, reply) => {
    const visitor = await currentVisitor(request);
    reply.header('cache-control', 'private, no-store');
    return { votes: await app.votes.listFor(visitor.id) };
  });
};
