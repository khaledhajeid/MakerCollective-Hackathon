import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import {
  AdminCredentialsIssuedSchema,
  AdminLoginSchema,
  AdminSessionSchema,
  AdminUserSchema,
  AuditPageSchema,
  AuditQuerySchema,
  CreateAdminSchema,
  MfaEnrollConfirmSchema,
  MfaEnrollStartSchema,
  MfaEnrolledSchema,
  MfaVerifiedSchema,
  MfaVerifySchema,
  PasswordChangeSchema,
  RecoveryCodesSchema,
  UpdateAdminSchema,
} from '@mc/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { manageRoutes } from './manage-routes.js';
import {
  actorOf,
  adminCookie,
  adminGuard,
  clearAdminCookie,
  sessionOf,
  setAdminCookie,
} from './guard.js';

const IdParams = z.object({ id: z.uuid() });
const Ok = z.object({ ok: z.literal(true) });

const originOf = (request: FastifyRequest) => ({
  ip: request.ip,
  userAgent: request.headers['user-agent'] ?? null,
});

/** `/api/admin/*`: sign-in, MFA, and the admin-account / audit endpoints. Phase 6 adds its routes to this scope. */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const publicOrigin = app.deps.env.PUBLIC_ORIGIN;
  const { name: cookieName } = adminCookie(publicOrigin);
  await app.register(adminGuard);
  await app.register(manageRoutes);

  /* ───────────── sign-in ───────────── */

  app.post(
    '/admin/auth/login',
    {
      config: { access: 'public' },
      schema: { body: AdminLoginSchema, response: { 200: AdminSessionSchema } },
    },
    async (request, reply) => {
      const { session, view } = await app.adminAuth.login(request.body, originOf(request));
      setAdminCookie(reply, publicOrigin, session);
      return view;
    },
  );

  /** Lets the console decide which screen to show. Answers 200 `{ authenticated: false }` rather than 401 when signed out. */
  app.get(
    '/admin/auth/session',
    { config: { access: 'public' }, schema: { response: { 200: AdminSessionSchema } } },
    async (request, reply) => {
      const token = request.cookies[cookieName];
      const session = token ? await app.adminSessions.resolve(token) : null;
      if (!session) {
        if (token) clearAdminCookie(reply, publicOrigin);
        return { authenticated: false as const };
      }
      return app.adminAuth.sessionView(session);
    },
  );

  app.post(
    '/admin/auth/mfa/verify',
    {
      config: { access: 'pending' },
      schema: { body: MfaVerifySchema, response: { 200: MfaVerifiedSchema } },
    },
    async (request, reply) => {
      const out = await app.adminAuth.verifyMfa(
        sessionOf(request),
        request.body,
        originOf(request),
      );
      setAdminCookie(reply, publicOrigin, out.session);
      return { session: out.view, recoveryCodesRemaining: out.recoveryCodesRemaining };
    },
  );

  app.post(
    '/admin/auth/mfa/enroll/start',
    { config: { access: 'pending' }, schema: { response: { 200: MfaEnrollStartSchema } } },
    async (request) => app.adminAuth.startEnrolment(sessionOf(request)),
  );

  app.post(
    '/admin/auth/mfa/enroll/confirm',
    {
      config: { access: 'pending' },
      schema: { body: MfaEnrollConfirmSchema, response: { 200: MfaEnrolledSchema } },
    },
    async (request, reply) => {
      const out = await app.adminAuth.confirmEnrolment(
        sessionOf(request),
        request.body.code,
        originOf(request),
      );
      setAdminCookie(reply, publicOrigin, out.session);
      return { recoveryCodes: out.recoveryCodes, session: out.view };
    },
  );

  app.post(
    '/admin/auth/recovery-codes',
    {
      config: { access: 'mfa' },
      schema: { body: MfaEnrollConfirmSchema, response: { 200: RecoveryCodesSchema } },
    },
    async (request) =>
      app.adminAuth.regenerateRecoveryCodes(
        sessionOf(request),
        request.body.code,
        originOf(request),
      ),
  );

  app.post(
    '/admin/auth/password',
    {
      config: { access: 'mfa' },
      schema: { body: PasswordChangeSchema, response: { 200: AdminSessionSchema } },
    },
    async (request, reply) => {
      const { session, view } = await app.adminAuth.changePassword(
        sessionOf(request),
        request.body,
        originOf(request),
      );
      setAdminCookie(reply, publicOrigin, session);
      return view;
    },
  );

  app.post(
    '/admin/auth/logout',
    { config: { access: 'pending' }, schema: { response: { 200: Ok } } },
    async (request, reply) => {
      await app.adminAuth.logout(sessionOf(request), originOf(request));
      clearAdminCookie(reply, publicOrigin);
      return { ok: true as const };
    },
  );

  /* ───────────── admin accounts (SUPER_ADMIN) ───────────── */

  app.get(
    '/admin/users',
    {
      config: { access: 'admins.read' },
      schema: { response: { 200: z.object({ users: z.array(AdminUserSchema) }) } },
    },
    async () => ({ users: await app.adminUsers.list() }),
  );

  app.post(
    '/admin/users',
    {
      config: { access: 'admins.manage' },
      schema: { body: CreateAdminSchema, response: { 200: AdminCredentialsIssuedSchema } },
    },
    async (request) => app.adminUsers.create(request.body, actorOf(request)),
  );

  app.patch(
    '/admin/users/:id',
    {
      config: { access: 'admins.manage' },
      schema: { params: IdParams, body: UpdateAdminSchema, response: { 200: AdminUserSchema } },
    },
    async (request) => app.adminUsers.update(request.params.id, request.body, actorOf(request)),
  );

  app.post(
    '/admin/users/:id/unlock',
    {
      config: { access: 'admins.manage' },
      schema: { params: IdParams, response: { 200: AdminUserSchema } },
    },
    async (request) => app.adminUsers.unlock(request.params.id, actorOf(request)),
  );

  app.post(
    '/admin/users/:id/reset-credentials',
    {
      config: { access: 'admins.manage' },
      schema: { params: IdParams, response: { 200: AdminCredentialsIssuedSchema } },
    },
    async (request) => app.adminUsers.resetCredentials(request.params.id, actorOf(request)),
  );

  app.post(
    '/admin/users/:id/sign-out',
    {
      config: { access: 'admins.manage' },
      schema: { params: IdParams, response: { 200: z.object({ ended: z.number().int() }) } },
    },
    async (request) => app.adminUsers.signOut(request.params.id, actorOf(request)),
  );

  /* ───────────── audit log (SUPER_ADMIN) ───────────── */

  app.get(
    '/admin/audit',
    {
      config: { access: 'audit.read' },
      schema: { querystring: AuditQuerySchema, response: { 200: AuditPageSchema } },
    },
    async (request) => app.adminAudit.page(request.query.limit, request.query.before),
  );
};
