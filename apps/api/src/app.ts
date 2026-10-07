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
import { AdminAuthService } from './modules/admin/service.js';
import { AdminSessions } from './modules/admin/sessions.js';
import { AdminUserService } from './modules/admin/users.js';
import { AuditReader } from './modules/admin/audit.js';
import { OverviewService } from './modules/admin/overview.js';
import { ContentService } from './modules/content/service.js';
import { ExportService } from './modules/export/service.js';
import { SettingsAdminService } from './modules/settings/admin.js';
import { VisitorAdminService } from './modules/visitors/admin.js';
import { photoRoutes } from './modules/content/routes.js';
import type { Access } from './modules/admin/permissions.js';
import { adminRoutes } from './modules/admin/routes.js';
import { AccessPolicy } from './modules/access/policy.js';
import { accessRoutes } from './modules/access/routes.js';
import { AuthService } from './modules/auth/service.js';
import { authRoutes } from './modules/auth/routes.js';
import { DisplayTokenService } from './modules/display/tokens.js';
import { displayRoutes } from './modules/display/routes.js';
import { ResultsHub, type HubOptions } from './modules/results/hub.js';
import { ResultsService } from './modules/results/service.js';
import { VoteService } from './modules/votes/service.js';
import { voteRoutes } from './modules/votes/routes.js';
import { SettingsCache } from './modules/settings/cache.js';
import { createSmsProvider } from './modules/sms/adapters.js';
import type { SmsProvider } from './modules/sms/provider.js';
import { RateLimiter } from './lib/rate-limit.js';
import { originGuardPlugin } from './plugins/origin-guard.js';
import { catalogRoutes } from './modules/catalog/routes.js';
import { scrubError } from './lib/log-scrub.js';
import { healthRoutes } from './modules/health/routes.js';
import { errorsPlugin } from './plugins/errors.js';
import { securityPlugin } from './plugins/security.js';

export interface AppDeps {
  env: Env;
  db: Database;
  redis: Redis | null;
  /** Test seam: replaces the SMS adapter chosen by SMS_PROVIDER. */
  sms?: SmsProvider;
  /** Test seam: faster coalescing / heartbeats for the results hub. */
  resultsHub?: Partial<HubOptions>;
  /** Test seam: the clock admin sessions, lock-outs and TOTP windows are judged against. */
  clock?: () => Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    settings: SettingsCache;
    access: AccessPolicy;
    limiter: RateLimiter;
    auth: AuthService;
    votes: VoteService;
    results: ResultsService;
    resultsHub: ResultsHub;
    displays: DisplayTokenService;
    adminSessions: AdminSessions;
    adminAuth: AdminAuthService;
    adminUsers: AdminUserService;
    adminAudit: AuditReader;
    content: ContentService;
    settingsAdmin: SettingsAdminService;
    visitorsAdmin: VisitorAdminService;
    overview: OverviewService;
    exporter: ExportService;
    /** Every /api/admin route and the access it declares (filled by the admin guard). */
    adminRouteTable: Array<{ method: string; url: string; access: Access }>;
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
  '*.currentPassword',
  '*.newPassword',
  '*.temporaryPassword',
  '*.recoveryCode',
  '*.recoveryCodes',
  '*.secret',
  '*.csrfToken',
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
              // No bound query parameters or row values in error logs (lib/log-scrub.ts).
              err: scrubError,
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

  // Browsers send `content-type: application/json` on body-less POSTs (logout…): treat an empty body as {}
  // instead of failing validation. Malformed JSON is still a 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Malformed JSON body'), { statusCode: 400 }), undefined);
    }
  });

  app.decorate('deps', deps);
  const settings = new SettingsCache(deps.db);
  const limiter = new RateLimiter(deps.redis, (err) =>
    app.log.warn({ err: String(err) }, 'redis rate-limit unavailable — using per-process counters'),
  );
  const sms = deps.sms ?? createSmsProvider(deps.env, deps.db, app.log);
  app.decorate('settings', settings);
  app.decorate(
    'access',
    new AccessPolicy(
      () => settings.get(),
      (rejected) =>
        app.log.error({ rejected }, 'venue range(s) unusable and ignored — fix in settings'),
    ),
  );
  app.decorate('limiter', limiter);
  app.decorate('auth', new AuthService(deps.env, deps.db, settings, limiter, sms));
  app.decorate('votes', new VoteService(deps.db));
  const results = new ResultsService(deps.db);
  const displays = new DisplayTokenService(deps.db);
  app.decorate('results', results);
  app.decorate('displays', displays);
  const adminSessions = new AdminSessions(deps.db, deps.clock);
  app.decorate('adminSessions', adminSessions);
  app.decorate('adminUsers', new AdminUserService(deps.db, adminSessions, deps.clock));
  app.decorate('adminAudit', new AuditReader(deps.db));
  app.decorate('content', new ContentService(deps.db));
  app.decorate('settingsAdmin', new SettingsAdminService(deps.db, settings));
  app.decorate('visitorsAdmin', new VisitorAdminService(env, deps.db, settings, limiter));
  app.decorate('overview', new OverviewService(deps.db));
  app.decorate('exporter', new ExportService(env, deps.db));
  app.decorate('adminRouteTable', []);
  app.decorate(
    'adminAuth',
    new AdminAuthService(deps.env, deps.db, adminSessions, limiter, deps.clock),
  );
  // Not started here: server.ts calls resultsHub.start() (opens the LISTEN connection). Unit tests never do.
  app.decorate(
    'resultsHub',
    new ResultsHub(
      {
        service: results,
        databaseUrl: deps.env.DATABASE_URL,
        activeTokenIds: (ids) => displays.activeIds(ids),
        log: app.log,
      },
      deps.resultsHub,
    ),
  );
  // Fastify's server.close() waits for every open connection and runs BEFORE onClose hooks, so a TV stream
  // would hang a restart until SIGKILL. preClose runs first: end the streams, then the server can drain.
  app.addHook('preClose', async () => {
    await app.resultsHub.close();
  });
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
      await api.register(photoRoutes);
      await api.register(accessRoutes);
      await api.register(authRoutes);
      await api.register(voteRoutes);
      await api.register(displayRoutes);
      await api.register(adminRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
