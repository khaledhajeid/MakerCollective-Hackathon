import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { AccessStatusSchema } from '@mc/shared';

/**
 * Public, read-only. Tells the caller what the server sees: the client IP resolved through the trusted
 * proxy chain and whether the venue gate would let it in. Doubles as
 *  - the end-to-end check of the Cloudflare tunnel (resolved IP must equal the caller's real public IP), and
 *  - a "what is my IP" helper for adding the venue's egress address in the admin console.
 * It only ever returns the caller's OWN address, so it discloses nothing about anyone else.
 */
export const accessRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/access/status',
    { schema: { response: { 200: AccessStatusSchema } } },
    async (request) => {
      const d = await app.access.evaluate(request.ip);
      return {
        allowed: d.allowed,
        enforced: d.mode !== 'OFF',
        clientIp: d.client?.ip ?? null,
        ipFamily: d.client?.family ?? null,
        wifiSsid: d.allowed ? null : await app.access.wifiSsid(),
      };
    },
  );
};
