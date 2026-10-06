import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated, state-changing requests (defence in depth on top of
 * SameSite=Lax and JSON-only bodies). A browser always sends `Origin` on cross-origin POSTs and
 * `Sec-Fetch-Site` on modern engines; non-browser clients (load tests, curl) send neither and are not
 * a CSRF vector because they have no ambient cookies to abuse.
 */
export const originGuardPlugin = fp(async (app: FastifyInstance) => {
  const allowed = new Set(
    [app.deps.env.PUBLIC_ORIGIN, ...app.deps.env.EXTRA_ORIGINS].map((o) => new URL(o).origin),
  );
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    if ((origin !== undefined && !allowed.has(origin)) || site === 'cross-site') {
      throw new AppError(403, 'CSRF_FAILED', 'Cross-site request refused');
    }
  });
});
