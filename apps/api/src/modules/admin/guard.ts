import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { can, type Access, type Permission } from './permissions.js';
import { writeAudit } from './audit.js';
import type { IssuedSession, ResolvedSession } from './sessions.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Required on every route under /api/admin. See permissions.ts. */
    access?: Access;
  }
  interface FastifyRequest {
    /** The signed-in session (null on `public` routes). Set by the guard before any handler runs. */
    adminSession: ResolvedSession | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The cookie: `__Host-` prefixed over HTTPS (the browser then refuses it unless it is Secure, host-only and
 * Path=/), SameSite=Strict (never sent on a cross-site request), HttpOnly (page scripts cannot read it).
 */
export function adminCookie(publicOrigin: string) {
  const secure = publicOrigin.startsWith('https://');
  return {
    name: secure ? '__Host-mc_admin' : 'mc_admin',
    options: { path: '/', httpOnly: true, secure, sameSite: 'strict' as const },
  };
}

export function setAdminCookie(reply: FastifyReply, publicOrigin: string, issued: IssuedSession) {
  const { name, options } = adminCookie(publicOrigin);
  reply.setCookie(name, issued.token, {
    ...options,
    maxAge: Math.max(1, Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000)),
  });
}

export function clearAdminCookie(reply: FastifyReply, publicOrigin: string) {
  const { name, options } = adminCookie(publicOrigin);
  reply.clearCookie(name, options);
}

/**
 * THE enforcement point for /api/admin. Fail-closed by construction:
 *  1. a route that does not declare `config.access` cannot be registered (the process refuses to boot);
 *  2. the check runs in `onRequest`, before body parsing, validation or any handler code;
 *  3. every request is judged against the database, not a claim carried by the browser: session, MFA state,
 *     password-change obligation, role and disabled flag are all read fresh from the stored session.
 * State-changing requests must also present the per-session CSRF token (on top of SameSite=Strict and the
 * global Origin check), compared in constant time.
 */
export const adminGuard = fp(async (app) => {
  const origin = app.deps.env.PUBLIC_ORIGIN;
  const { name: cookieName } = adminCookie(origin);

  app.decorateRequest('adminSession', null);

  app.addHook('onRoute', (route) => {
    const access = route.config?.access;
    if (!access)
      throw new Error(
        `${String(route.method)} ${route.url}: every /api/admin route must declare config.access (see permissions.ts)`,
      );
    // The authorisation table is data a test can walk: no route is exempt from the matrix by being forgotten.
    for (const method of [route.method].flat())
      app.adminRouteTable.push({ method, url: route.url, access });
  });

  app.addHook('onRequest', async (request, reply) => {
    const access = request.routeOptions.config.access as Access;
    if (access === 'public') return;

    const token = request.cookies[cookieName];
    const session = token ? await app.adminSessions.resolve(token) : null;
    if (!session) {
      if (token) clearAdminCookie(reply, origin);
      throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
    }
    request.adminSession = session;

    if (!SAFE_METHODS.has(request.method)) {
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, session.csrfSecret))
        throw new AppError(403, 'CSRF_FAILED', 'Cross-site request refused');
    }

    if (access === 'pending') return;
    if (!session.mfaVerified) throw new AppError(403, 'MFA_REQUIRED', 'Second factor required');
    if (access === 'mfa') return;
    if (session.admin.mustChangePassword)
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password first');
    if (!can(session.admin.role, access as Permission)) {
      // A signed-in admin reaching for something their role does not allow is worth a line in the log.
      await writeAudit(app.deps.db, {
        adminId: session.admin.id,
        label: `admin:${session.admin.username}`,
        action: 'admin.access.denied',
        details: { permission: access, method: request.method, route: request.routeOptions.url },
        ip: request.ip,
      }).catch(() => undefined);
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do that');
    }
  });
});

/** The signed-in session a non-public handler runs under. The guard guarantees it; this narrows the type. */
export function sessionOf(request: FastifyRequest): ResolvedSession {
  if (!request.adminSession) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in');
  return request.adminSession;
}

export function actorOf(request: FastifyRequest) {
  const s = sessionOf(request);
  return { adminId: s.admin.id, label: `admin:${s.admin.username}`, ip: request.ip };
}
