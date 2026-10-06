import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';
import { healthRoutes } from './modules/health/routes.js';
import { errorsPlugin } from './plugins/errors.js';
import { securityPlugin } from './plugins/security.js';

export interface AppDeps {
  env: Env;
  db: Database;
  redis: Redis | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

/** Fields that must never reach logs (PII, OTPs, credentials, session material). */
const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.phone',
  '*.code',
  '*.otp',
  '*.password',
  '*.totp',
  '*.name',
];

export async function buildApp(deps: AppDeps, overrides: FastifyServerOptions = {}) {
  const { env } = deps;
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
            // Log the trust-resolved client IP (not the proxy socket) and drop query strings.
            serializers: {
              req: (req: FastifyRequest) => ({
                method: req.method,
                url: req.routeOptions.url ?? req.url.split('?')[0],
                ip: req.ip,
              }),
            },
            // Pretty logs only for a human at a terminal; containers emit JSON lines.
            ...(env.NODE_ENV === 'development' &&
              process.stdout.isTTY && { transport: { target: 'pino-pretty' } }),
          },
    // Only the configured proxy hops may set X-Forwarded-For (see env.ts).
    trustProxy: env.TRUST_PROXY,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
    ...overrides,
  }).withTypeProvider<ZodTypeProvider>();

  app.decorate('deps', deps);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(cookie, { secret: env.SESSION_SECRET });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
