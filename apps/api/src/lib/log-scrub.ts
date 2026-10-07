/**
 * Error serializer for the logs. Drizzle puts the bound parameters into the message of a failed query
 * ("Failed query: … params: …") and the driver adds `detail` ("Key (phone_hash)=(…) already exists"); either can
 * carry a session secret, a phone hash or a name. Logs keep what is needed to diagnose (type, SQL state,
 * constraint, table, the SQL text and the stack) and drop the values (Phase 5 review, backlog item).
 */
const KEEP = [
  'code',
  'severity',
  'constraint',
  'table',
  'schema',
  'column',
  'routine',
  'statusCode',
];
const FRAME = /\n\s+at /;

const header = (message: string) => message.split(/\n\s*params:/)[0]!.slice(0, 600);

export interface ScrubbedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

export function scrubError(err: unknown, depth = 0): ScrubbedError {
  if (!(err instanceof Error))
    return {
      type: 'NonError',
      message: typeof err === 'string' ? err.slice(0, 200) : '[non-error value]',
      stack: '',
    };
  const e = err as Error & Record<string, unknown>;
  const message = header(e.message);
  const frames = (e.stack ?? '').split(FRAME).slice(1);
  const out: ScrubbedError = { type: e.name, message, stack: '' };
  for (const k of KEEP) if (typeof e[k] === 'string' || typeof e[k] === 'number') out[k] = e[k];
  out.stack = [`${e.name}: ${message}`, ...frames.map((f) => `    at ${f}`)].join('\n');
  if (e.cause && depth < 3) out.cause = scrubError(e.cause, depth + 1);
  return out;
}
