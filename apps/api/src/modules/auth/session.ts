import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';

/**
 * Visitor session = a signed, expiring cookie carrying only the visitor id (stateless, so any replica can
 * verify it). Signature uses SESSION_SECRET; HttpOnly keeps it from page scripts; SameSite=Lax plus the
 * Origin check (plugins/origin-guard.ts) covers CSRF. A block/ban takes effect on the next request because
 * the visitor row is re-read when it matters (voting).
 */
export const SESSION_COOKIE = 'mc_session';
export const DEVICE_COOKIE = 'mc_device';
export const SESSION_TTL_SEC = 12 * 60 * 60;
const DEVICE_TTL_SEC = 365 * 24 * 60 * 60;
const DEVICE_RE = /^[A-Za-z0-9_-]{22}$/;

const secure = (env: Env) => env.PUBLIC_ORIGIN.startsWith('https://');

export function issueSession(reply: FastifyReply, env: Env, visitorId: string): void {
  const now = Date.now();
  const exp = Math.floor(now / 1000) + SESSION_TTL_SEC;
  reply.setCookie(SESSION_COOKIE, `${visitorId}.${now}.${exp}`, {
    httpOnly: true,
    secure: secure(env),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
    signed: true,
  });
}

export function clearSession(reply: FastifyReply, env: Env): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: secure(env),
    sameSite: 'lax',
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Returns the visitor id + issue time from a valid, unexpired, correctly signed cookie — otherwise null. */
export function readSession(request: FastifyRequest): { id: string; issuedAtMs: number } | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const [id, iat, exp, ...rest] = unsigned.value.split('.');
  if (
    rest.length ||
    !id ||
    !UUID_RE.test(id) ||
    !iat ||
    !Number.isSafeInteger(Number(iat)) ||
    !exp ||
    Number(exp) <= Date.now() / 1000
  )
    return null;
  return { id, issuedAtMs: Number(iat) };
}

/**
 * Per-browser identifier used for rate limiting and fraud analysis. It is NOT a security boundary (a
 * visitor can clear it), so it is only ever combined with limits keyed on the phone and the venue IP.
 */
export function ensureDeviceId(request: FastifyRequest, reply: FastifyReply, env: Env): string {
  const existing = request.cookies[DEVICE_COOKIE];
  if (existing && DEVICE_RE.test(existing)) return existing;
  const id = randomBytes(16).toString('base64url');
  reply.setCookie(DEVICE_COOKIE, id, {
    httpOnly: true,
    secure: secure(env),
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_TTL_SEC,
  });
  return id;
}
