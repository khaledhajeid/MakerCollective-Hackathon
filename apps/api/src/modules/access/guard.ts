import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';

/**
 * Per-route preHandler: the caller must be on the venue network (F10/F11, ADR-002). Applied per route (not via a
 * prefix hook) so a new credential- or vote-bearing endpoint cannot silently miss the gate.
 */
export function venueGuard(app: Pick<FastifyInstance, 'access'>) {
  return async (request: FastifyRequest): Promise<void> => {
    const decision = await app.access.evaluate(request.ip);
    if (!decision.allowed) {
      request.log.info({ reason: decision.reason }, 'venue gate refused request');
      throw new AppError(403, 'NOT_ON_VENUE_NETWORK', 'Connect to the event Wi-Fi to vote', {
        wifiSsid: await app.access.wifiSsid(),
      });
    }
  };
}
