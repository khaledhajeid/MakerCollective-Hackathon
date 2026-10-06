import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Liveness: the process is up. Readiness: it can serve traffic.
 * Postgres is the only hard dependency; Redis being down is reported as
 * "degraded" but does not take the replica out of rotation (ADR-001).
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/healthz',
    { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
    async () => ({ status: 'ok' as const }),
  );

  const ReadySchema = z.object({
    status: z.enum(['ready', 'degraded', 'unavailable']),
    checks: z.object({
      database: z.enum(['up', 'down']),
      redis: z.enum(['up', 'down', 'disabled']),
    }),
  });

  app.get(
    '/readyz',
    { schema: { response: { 200: ReadySchema, 503: ReadySchema } } },
    async (_req, reply) => {
      const [database, redis] = await Promise.all([
        app.deps.db
          .execute(sql`select 1`)
          .then(() => 'up' as const)
          .catch(() => 'down' as const),
        app.deps.redis
          ? app.deps.redis
              .ping()
              .then(() => 'up' as const)
              .catch(() => 'down' as const)
          : Promise.resolve('disabled' as const),
      ]);

      const status = database === 'down' ? 'unavailable' : redis === 'down' ? 'degraded' : 'ready';
      return reply
        .status(database === 'down' ? 503 : 200)
        .send({ status, checks: { database, redis } });
    },
  );
};
