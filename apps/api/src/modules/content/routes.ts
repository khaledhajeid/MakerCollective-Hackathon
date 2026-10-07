import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

const Params = z.object({ key: z.string().regex(/^[a-f0-9-]{36}\.webp$/) });

/**
 * Public exhibitor photos. A key is a random UUID chosen by the server, so a URL never changes meaning: a new upload is
 * a new URL, which is why the answer can be cached for a year by the browser and the CDN (and why the voters' phones
 * fetch each photo once). Served with nosniff so the bytes can only ever be treated as an image.
 */
export const photoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/photos/:key', { schema: { params: Params } }, async (request, reply) => {
    const bytes = await app.content.photo(request.params.key);
    if (!bytes) throw new AppError(404, 'NOT_FOUND', 'No such photo');
    return reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(bytes);
  });
};
