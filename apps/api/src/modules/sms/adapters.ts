import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { smsOutbox } from '../../db/schema.js';
import type { SmsProvider } from './provider.js';

/** Development only: prints the message (incl. the code) to the API log. */
export function consoleProvider(log: FastifyBaseLogger): SmsProvider {
  return {
    name: 'console',
    async send({ toMasked, text }) {
      log.warn({ to: toMasked, text }, 'SMS (console provider — development only)');
    },
  };
}

/** Pitch demo: messages land in `sms_outbox`, shown on the admin "SMS inbox" screen (Phase 6). */
export function demoInboxProvider(db: Database): SmsProvider {
  return {
    name: 'demo-inbox',
    async send({ toMasked, text }) {
      await db.insert(smsOutbox).values({ toMasked, body: text });
    },
  };
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Substitute placeholders in string VALUES only, so message text can never alter the JSON structure. */
export function fillTemplate(node: Json, vars: Record<string, string>): Json {
  if (typeof node === 'string')
    return node.replace(/\{(to|message)\}/g, (_m, k: string) => vars[k] ?? '');
  if (Array.isArray(node)) return node.map((n) => fillTemplate(n, vars));
  if (node && typeof node === 'object')
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillTemplate(v, vars)]));
  return node;
}

/** The organisers' own gateway: any HTTPS JSON API, configured purely through env (no code change). */
export function httpProvider(env: Env, fetchImpl: typeof fetch = fetch): SmsProvider {
  const url = env.SMS_HTTP_URL!;
  const template = JSON.parse(env.SMS_HTTP_BODY_TEMPLATE!) as Json;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.SMS_HTTP_AUTH_HEADER) {
    const i = env.SMS_HTTP_AUTH_HEADER.indexOf(':');
    if (i > 0)
      headers[env.SMS_HTTP_AUTH_HEADER.slice(0, i).trim()] = env.SMS_HTTP_AUTH_HEADER.slice(
        i + 1,
      ).trim();
  }
  return {
    name: 'http',
    async send({ toE164, text }) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(fillTemplate(template, { to: toE164, message: text })),
        redirect: 'error', // never follow a gateway redirect to an unexpected host
        signal: AbortSignal.timeout(env.SMS_HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
    },
  };
}

export function createSmsProvider(env: Env, db: Database, log: FastifyBaseLogger): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case 'console':
      return consoleProvider(log);
    case 'demo-inbox':
      return demoInboxProvider(db);
    case 'http':
      return httpProvider(env);
  }
}
