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
import { AccessPolicy } from './modules/access/policy.js';
import { accessRoutes } from './modules/access/routes.js';
import { AuthService } from './modules/auth/service.js';
import { authRoutes } from './modules/auth/routes.js';
import { SettingsCache } from './modules/settings/cache.js';
import { createSmsProvider } from './modules/sms/adapters.js';
import type { SmsProvider } from './modules/sms/provider.js';
import { RateLimiter } from './lib/rate-limit.js';
import { originGuardPlugin } from './plugins/origin-guard.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { errorsPlugin } from './plugins/errors.js';
import { securityPlugin } from './plugins/security.js';

export interface AppDeps {
  env: Env;
  db: Database;
  redis: Redis | null;
  /** Test seam: replaces the SMS adapter chosen by SMS_PROVIDER. */
  sms?: SmsProvider;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    settings: SettingsCache;
    access: AccessPolicy;
    limiter: RateLimiter;
    auth: AuthService;
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
  const settings = new SettingsCache(deps.db);
  const limiter = new RateLimiter(deps.redis, (err) =>
    app.log.warn({ err: String(err) }, 'redis rate-limit unavailable — using per-process counters'),
  );
  const sms = deps.sms ?? createSmsProvider(deps.env, deps.db, app.log);
  app.decorate('settings', settings);
  app.decorate('access', new AccessPolicy(() => settings.get()));
  app.decorate('limiter', limiter);
  app.decorate('auth', new AuthService(deps.env, deps.db, settings, limiter, sms));
  if (deps.env.DEMO_MODE || deps.env.SMS_PROVIDER !== 'http')
    app.log.warn({ sms: sms.name }, 'DEMO/DEV SMS adapter active — OTPs are NOT sent to phones');
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(originGuardPlugin);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(catalogRoutes);
      await api.register(accessRoutes);
      await api.register(authRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
