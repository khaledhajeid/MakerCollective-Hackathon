import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Security headers for API responses. The API only ever returns JSON/SSE, so the
 * CSP is maximally strict; the SPA's own CSP is set by Caddy (infra/Caddyfile).
 */
export const securityPlugin = fp(async (app: FastifyInstance) => {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // No includeSubDomains: the app lives on one hostname of a shared domain (code review, tunnel commit).
    hsts: { maxAge: 63_072_000, includeSubDomains: false },
  });

  // Responses carry per-user state; never let a shared cache store them.
  app.addHook('onSend', async (_request, reply) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });
});
