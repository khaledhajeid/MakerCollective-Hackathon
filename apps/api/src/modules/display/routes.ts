import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { DisplayPairRequestSchema, DisplaySessionSchema } from '@mc/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import type { StreamClient } from '../results/hub.js';
import type { DisplayIdentity } from './tokens.js';

/**
 * TV displays (plan §2.3). A TV is paired once with a revocable display token: it is POSTed (never put in a
 * query string, so it stays out of access logs and referrers) and then lives in an HttpOnly, SameSite=Strict
 * cookie scoped to /api/display. Every stream open re-checks the token against the database, and the hub
 * re-checks all open streams every few seconds, so revoking a token blanks that TV within seconds.
 * Display tokens carry no PII and can only read the results frame.
 */
export const DISPLAY_COOKIE = 'mc_display';
const COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

export const displayRoutes: FastifyPluginAsyncZod = async (app) => {
  const secure = app.deps.env.PUBLIC_ORIGIN.startsWith('https://');
  const cookieBase = {
    path: '/api/display',
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
  };

  const authenticate = async (request: FastifyRequest): Promise<DisplayIdentity> => {
    // Every authenticated read costs a lookup; a malformed cookie is refused before the database, a well-formed
    // one is capped per address (generous: a venue shares one IP, and TVs connect a handful of times).
    const hit = await app.limiter.hit('display-auth', request.ip, 600, 60);
    if (!hit.allowed) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts, please wait', {
        retryAfterSeconds: hit.retryAfterSec,
      });
    }
    const token = request.cookies[DISPLAY_COOKIE];
    const identity = token ? await app.displays.verify(token) : null;
    if (!identity) throw new AppError(401, 'UNAUTHENTICATED', 'This screen is not paired');
    return identity;
  };

  app.post(
    '/display/pair',
    { schema: { body: DisplayPairRequestSchema, response: { 200: DisplaySessionSchema } } },
    async (request, reply) => {
      // Tokens are 256-bit, so guessing is hopeless; the limit only protects the database from floods. It is generous
      // on purpose: the whole venue shares one IP, and a tight cap would let one noisy client block a TV from pairing.
      const hit = await app.limiter.hit('display-pair', request.ip, 300, 600);
      if (!hit.allowed) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many attempts, please wait', {
          retryAfterSeconds: hit.retryAfterSec,
        });
      }
      const identity = await app.displays.verify(request.body.token);
      if (!identity) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid display code');
      reply.setCookie(DISPLAY_COOKIE, request.body.token, {
        ...cookieBase,
        maxAge: COOKIE_MAX_AGE_SEC,
      });
      return { label: identity.label };
    },
  );

  /** Lets a TV decide between "show the pairing screen" and "open the stream" (EventSource errors carry no status). */
  app.get(
    '/display/session',
    { schema: { response: { 200: DisplaySessionSchema } } },
    async (request) => ({ label: (await authenticate(request)).label }),
  );

  app.post('/display/unpair', async (_request, reply) => {
    reply.clearCookie(DISPLAY_COOKIE, cookieBase);
    return reply.code(204).send();
  });

  /**
   * Server-Sent Events: `frame` (full state, sent on connect and whenever it changes), `time` (heartbeat with
   * the server clock) and `revoked`. Reply headers are written by hand because the socket is taken over.
   */
  app.get('/display/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const display = await authenticate(request);
    if (!app.resultsHub.hasCapacity())
      throw new AppError(429, 'RATE_LIMITED', 'Too many displays connected', {
        retryAfterSeconds: 5,
      });
    void app.displays.touch(display.id).catch(() => undefined);

    const res = reply.raw;
    reply.hijack();
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform + no buffering: proxies and the tunnel must pass each event through immediately.
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
      'x-request-id': request.id,
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    });
    // Reconnect quickly after an API restart; the next connect always starts with a full frame.
    res.write('retry: 2000\n\n');

    const client: StreamClient = {
      tokenId: display.id,
      send(chunk) {
        if (res.writableEnded || res.destroyed) return false;
        res.write(chunk);
        // A TV that cannot keep up (stalled socket) is dropped instead of buffering without bound.
        return res.writableLength < 512 * 1024;
      },
      close(reason) {
        return new Promise<void>((resolve) => {
          if (res.writableEnded || res.destroyed) return resolve();
          res.once('close', () => resolve());
          if (reason) res.write(`event: ${reason}\ndata: {}\n\n`);
          res.end(() => resolve());
        });
      },
    };

    let unsubscribe: (() => void) | null = null;
    const onClose = () => unsubscribe?.();
    request.raw.once('close', onClose);
    try {
      unsubscribe = await app.resultsHub.subscribe(client);
      // The TV may have gone away while the first frame was being computed.
      if (res.destroyed || res.writableEnded) unsubscribe();
    } catch (err) {
      request.log.warn({ err: String(err) }, 'display stream refused');
      client.close();
    }
  });
};
