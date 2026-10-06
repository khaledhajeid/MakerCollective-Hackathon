import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import {
  OtpRequestResponseSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  SessionSchema,
  toAsciiDigits,
} from '@mc/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { clearSession, ensureDeviceId, issueSession, readSession } from './session.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { env } = app.deps;

  /** Every credential-issuing step requires the visitor to be on the venue network (F10/F11, ADR-002). */
  const requireVenue = async (request: FastifyRequest) => {
    const decision = await app.access.evaluate(request.ip);
    if (!decision.allowed) {
      request.log.info({ reason: decision.reason }, 'venue gate refused request');
      throw new AppError(403, 'NOT_ON_VENUE_NETWORK', 'Connect to the event Wi-Fi to vote', {
        wifiSsid: await app.access.wifiSsid(),
      });
    }
  };

  app.post(
    '/auth/otp/request',
    {
      preHandler: requireVenue,
      schema: { body: OtpRequestSchema, response: { 200: OtpRequestResponseSchema } },
    },
    async (request, reply) => {
      const deviceId = ensureDeviceId(request, reply, env);
      return app.auth.requestOtp(request.body, { ip: request.ip, deviceId });
    },
  );

  app.post(
    '/auth/otp/verify',
    {
      preHandler: requireVenue,
      schema: {
        body: OtpVerifySchema,
        response: { 200: z.object({ visitor: SessionSchema.shape.visitor.unwrap() }) },
      },
    },
    async (request, reply) => {
      const deviceId = ensureDeviceId(request, reply, env);
      const profile = await app.auth.verifyOtp(
        { challengeId: request.body.challengeId, code: toAsciiDigits(request.body.code) },
        { ip: request.ip, deviceId },
      );
      issueSession(reply, env, profile.id);
      return {
        visitor: { name: profile.name, maskedPhone: profile.maskedPhone, locale: profile.locale },
      };
    },
  );

  app.get('/auth/session', { schema: { response: { 200: SessionSchema } } }, async (request) => {
    const session = readSession(request);
    const visitor = session ? await app.auth.visitorForSession(session) : null;
    if (!visitor) return { authenticated: false, visitor: null };
    const p = app.auth.profile(visitor);
    return {
      authenticated: true,
      visitor: { name: p.name, maskedPhone: p.maskedPhone, locale: p.locale },
    };
  });

  app.post(
    '/auth/logout',
    { schema: { response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request, reply) => {
      const session = readSession(request);
      if (session) await app.auth.revokeSessions(session.id);
      clearSession(reply, env);
      return { ok: true as const };
    },
  );
};
