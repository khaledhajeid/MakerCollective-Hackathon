import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import {
  AdminCategorySchema,
  AdminDisplaySchema,
  AdminExhibitorSchema,
  CategoryCreateSchema,
  CategoryPatchSchema,
  ContentSchema,
  DisplayCreateSchema,
  DisplayCreatedSchema,
  ExhibitorBulkSchema,
  ExhibitorBulkResultSchema,
  ExhibitorCreateSchema,
  ExhibitorPatchSchema,
  ExportParamsSchema,
  LiveResultsSchema,
  ModeChangedSchema,
  NetworkMeSchema,
  OverviewSchema,
  PHOTO_MAX_BYTES,
  ReorderSchema,
  ResultsModeSchema,
  RevealSchema,
  RevealedSchema,
  SettingsPatchSchema,
  SettingsSchema,
  SmsInboxSchema,
  ThrottleClearSchema,
  VisitorBlockSchema,
  VisitorPageSchema,
  VisitorQuerySchema,
  VisitorRevealRequestSchema,
  VisitorRevealedSchema,
} from '@mc/shared/manage';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { smsOutbox } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { parseIp, rateKey } from '../../lib/ip.js';
import { actorOf } from './guard.js';

const IdParams = z.object({ id: z.uuid() });
const Ok = z.object({ ok: z.literal(true) });
const ok = { ok: true as const };

/** A TV that has not been heard from for this long is shown as offline. */
const ONLINE_MS = 2 * 60_000;

/**
 * The event-running half of `/api/admin` (Phase 6, ADR-008). Every route here declares the permission it needs; the
 * guard (registered by the parent scope) enforces it before any handler runs, and the RBAC sweep test walks this table.
 */
export const manageRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ───────────── overview & results control ───────────── */

  app.get(
    '/admin/overview',
    { config: { access: 'overview.read' }, schema: { response: { 200: OverviewSchema } } },
    async () => app.overview.overview(),
  );

  app.get(
    '/admin/results/live',
    { config: { access: 'results.live' }, schema: { response: { 200: LiveResultsSchema } } },
    async (request) => app.overview.liveResults(actorOf(request)),
  );

  app.post(
    '/admin/results/mode',
    {
      config: { access: 'results.control' },
      schema: { body: ResultsModeSchema, response: { 200: ModeChangedSchema } },
    },
    async (request) => app.results.setMode(request.body.mode, actorOf(request)),
  );

  app.post(
    '/admin/results/reveal',
    {
      config: { access: 'results.control' },
      schema: { body: RevealSchema, response: { 200: RevealedSchema } },
    },
    async (request) =>
      app.results.revealCategory({ categoryId: request.body.categoryId }, actorOf(request)),
  );

  /* ───────────── categories & exhibitors ───────────── */

  app.get(
    '/admin/content',
    { config: { access: 'content.manage' }, schema: { response: { 200: ContentSchema } } },
    async () => app.content.list(),
  );

  app.post(
    '/admin/categories',
    {
      config: { access: 'content.manage' },
      schema: { body: CategoryCreateSchema, response: { 200: AdminCategorySchema } },
    },
    async (request) => app.content.createCategory(request.body, actorOf(request)),
  );

  app.put(
    '/admin/categories/order',
    {
      config: { access: 'content.manage' },
      schema: {
        body: ReorderSchema,
        response: { 200: z.object({ categories: z.array(AdminCategorySchema) }) },
      },
    },
    async (request) => ({
      categories: await app.content.reorderCategories(request.body.ids, actorOf(request)),
    }),
  );

  app.patch(
    '/admin/categories/:id',
    {
      config: { access: 'content.manage' },
      schema: {
        params: IdParams,
        body: CategoryPatchSchema,
        response: { 200: AdminCategorySchema },
      },
    },
    async (request) =>
      app.content.updateCategory(request.params.id, request.body, actorOf(request)),
  );

  app.delete(
    '/admin/categories/:id',
    { config: { access: 'content.manage' }, schema: { params: IdParams, response: { 200: Ok } } },
    async (request) => {
      await app.content.deleteCategory(request.params.id, actorOf(request));
      return ok;
    },
  );

  app.post(
    '/admin/exhibitors',
    {
      config: { access: 'content.manage' },
      schema: { body: ExhibitorCreateSchema, response: { 200: AdminExhibitorSchema } },
    },
    async (request) => app.content.createExhibitor(request.body, actorOf(request)),
  );

  // A spreadsheet of up to 300 rows is far larger than the 64 KB default, so this one route has its own limit.
  app.post(
    '/admin/exhibitors/bulk',
    {
      config: { access: 'content.manage' },
      bodyLimit: 1024 * 1024,
      schema: { body: ExhibitorBulkSchema, response: { 200: ExhibitorBulkResultSchema } },
    },
    async (request) => app.content.createExhibitors(request.body.exhibitors, actorOf(request)),
  );

  app.patch(
    '/admin/exhibitors/:id',
    {
      config: { access: 'content.manage' },
      schema: {
        params: IdParams,
        body: ExhibitorPatchSchema,
        response: { 200: AdminExhibitorSchema },
      },
    },
    async (request) =>
      app.content.updateExhibitor(request.params.id, request.body, actorOf(request)),
  );

  app.delete(
    '/admin/exhibitors/:id',
    { config: { access: 'content.manage' }, schema: { params: IdParams, response: { 200: Ok } } },
    async (request) => {
      await app.content.deleteExhibitor(request.params.id, actorOf(request));
      return ok;
    },
  );

  // The photo travels as the raw bytes of a WebP file (the console crops and encodes it in the browser). Only this
  // content type gets a body parser, and only up to the photo limit; everything else keeps the 64 KB default.
  app.addContentTypeParser(
    'image/webp',
    { parseAs: 'buffer', bodyLimit: PHOTO_MAX_BYTES + 1024 },
    (_request, body, done) => done(null, body),
  );

  app.put(
    '/admin/exhibitors/:id/photo',
    {
      config: { access: 'content.manage' },
      bodyLimit: PHOTO_MAX_BYTES + 1024,
      schema: { params: IdParams, response: { 200: AdminExhibitorSchema } },
    },
    async (request) => {
      if (!Buffer.isBuffer(request.body))
        throw new AppError(400, 'VALIDATION_FAILED', 'Send the photo as an image/webp file');
      return app.content.setPhoto(request.params.id, request.body, actorOf(request));
    },
  );

  app.delete(
    '/admin/exhibitors/:id/photo',
    {
      config: { access: 'content.manage' },
      schema: { params: IdParams, response: { 200: AdminExhibitorSchema } },
    },
    async (request) => app.content.removePhoto(request.params.id, actorOf(request)),
  );

  /* ───────────── settings ───────────── */

  app.get(
    '/admin/settings',
    { config: { access: 'settings.manage' }, schema: { response: { 200: SettingsSchema } } },
    async () => app.settingsAdmin.get(),
  );

  app.patch(
    '/admin/settings',
    {
      config: { access: 'settings.manage' },
      schema: { body: SettingsPatchSchema, response: { 200: SettingsSchema } },
    },
    async (request) => app.settingsAdmin.update(request.body, actorOf(request)),
  );

  /** "Add my current IP": what the server sees of THIS browser, and whether the venue gate would admit it. */
  app.get(
    '/admin/network/me',
    { config: { access: 'settings.manage' }, schema: { response: { 200: NetworkMeSchema } } },
    async (request) => {
      const client = parseIp(request.ip);
      const decision = await app.access.evaluate(request.ip);
      return {
        ip: client?.ip ?? null,
        family: client?.family ?? null,
        // An IPv6 device owns a whole /64 and rotates inside it, so a single /128 would stop matching within hours.
        suggestion: client ? (client.family === 4 ? client.ip : rateKey(client)) : null,
        admitted: decision.allowed && decision.reason === 'ok',
      };
    },
  );

  /* ───────────── TV displays ───────────── */

  const displayView = (r: Awaited<ReturnType<typeof app.displays.list>>[number]) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    online: !r.revokedAt && !!r.lastSeenAt && Date.now() - r.lastSeenAt.getTime() < ONLINE_MS,
  });

  app.get(
    '/admin/displays',
    {
      config: { access: 'displays.manage' },
      schema: { response: { 200: z.object({ displays: z.array(AdminDisplaySchema) }) } },
    },
    async () => ({ displays: (await app.displays.list()).map(displayView) }),
  );

  app.post(
    '/admin/displays',
    {
      config: { access: 'displays.manage' },
      schema: { body: DisplayCreateSchema, response: { 200: DisplayCreatedSchema } },
    },
    async (request) => {
      const { id, token } = await app.displays.create(request.body.label, actorOf(request));
      const row = (await app.displays.list()).find((d) => d.id === id)!;
      const origin = app.deps.env.PUBLIC_ORIGIN.replace(/\/$/, '');
      return { display: displayView(row), pairingUrl: `${origin}/live#t=${token}` };
    },
  );

  app.delete(
    '/admin/displays/:id',
    { config: { access: 'displays.manage' }, schema: { params: IdParams, response: { 200: Ok } } },
    async (request) => {
      if (!(await app.displays.revoke(request.params.id, actorOf(request))))
        throw new AppError(404, 'NOT_FOUND', 'No such active display');
      return ok;
    },
  );

  // Off the list for good. Also switches the screen off if it was still on.
  app.post(
    '/admin/displays/:id/remove',
    { config: { access: 'displays.manage' }, schema: { params: IdParams, response: { 200: Ok } } },
    async (request) => {
      if (!(await app.displays.remove(request.params.id, actorOf(request))))
        throw new AppError(404, 'NOT_FOUND', 'No such display');
      return ok;
    },
  );

  /* ───────────── visitors ───────────── */

  app.get(
    '/admin/visitors',
    {
      config: { access: 'visitors.read' },
      schema: { querystring: VisitorQuerySchema, response: { 200: VisitorPageSchema } },
    },
    async (request) => app.visitorsAdmin.list(request.query),
  );

  app.post(
    '/admin/visitors/:id/block',
    {
      config: { access: 'visitors.manage' },
      schema: { params: IdParams, body: VisitorBlockSchema, response: { 200: VisitorBlockSchema } },
    },
    async (request) =>
      app.visitorsAdmin.setBlocked(request.params.id, request.body.blocked, actorOf(request)),
  );

  app.post(
    '/admin/visitors/:id/sign-out',
    { config: { access: 'visitors.manage' }, schema: { params: IdParams, response: { 200: Ok } } },
    async (request) => {
      await app.visitorsAdmin.signOut(request.params.id, actorOf(request));
      return ok;
    },
  );

  app.post(
    '/admin/visitors/:id/reveal',
    {
      config: { access: 'visitors.unmask' },
      schema: {
        params: IdParams,
        body: VisitorRevealRequestSchema,
        response: { 200: VisitorRevealedSchema },
      },
    },
    async (request) =>
      app.visitorsAdmin.unmask(request.params.id, request.body.reason, actorOf(request)),
  );

  app.post(
    '/admin/otp-throttle/clear',
    {
      config: { access: 'visitors.manage' },
      schema: {
        body: ThrottleClearSchema,
        response: { 200: z.object({ cleared: z.number().int() }) },
      },
    },
    async (request) => app.visitorsAdmin.clearOtpThrottle(request.body.phone, actorOf(request)),
  );

  /* ───────────── export, demo SMS inbox ───────────── */

  app.get(
    '/admin/export/:kind',
    { config: { access: 'export.run' }, schema: { params: ExportParamsSchema } },
    async (request, reply) => {
      const file = await app.exporter.run(request.params.kind, actorOf(request));
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .send(file.body);
    },
  );

  // The audit trail as a spreadsheet. SUPER_ADMIN only, like reading it on screen; the download is itself audited.
  app.get('/admin/audit/export', { config: { access: 'audit.read' } }, async (request, reply) => {
    const file = await app.exporter.auditLog(actorOf(request));
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${file.filename}"`)
      .send(file.body);
  });

  app.get(
    '/admin/sms-inbox',
    { config: { access: 'sms.inbox' }, schema: { response: { 200: SmsInboxSchema } } },
    async () => {
      const rows = await app.deps.db
        .select()
        .from(smsOutbox)
        .orderBy(desc(smsOutbox.createdAt))
        .limit(50);
      return {
        messages: rows.map((r) => ({
          id: r.id,
          to: r.toMasked,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );
};
