import { CatalogResponseSchema } from '@mc/shared';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { loadCatalog } from './repository.js';

/** Public, read-only (F1). The response holds no voter data, so a short shared cache is safe. */
export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/catalog',
    { schema: { response: { 200: CatalogResponseSchema } } },
    async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=10, stale-while-revalidate=30');
      return { categories: await loadCatalog(app.deps.db) };
    },
  );
};
