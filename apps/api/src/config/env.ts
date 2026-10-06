import { z } from 'zod';

/**
 * Process configuration. Parsed once at boot; the process refuses to start on
 * any missing/invalid value (fail fast, never run half-configured).
 * Event-level settings (voting window, venue IPs, Blind Hour…) are NOT here —
 * they live in the database so organisers can change them live.
 */
const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Public origin users reach the app on (tunnel URL in the demo). Used for CSRF origin checks & cookies. */
    PUBLIC_ORIGIN: z.url(),

    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Optional: Redis accelerates rate limiting; the API degrades gracefully without it. */
    REDIS_URL: z.url().optional(),

    /**
     * Exact IPs/CIDRs of the reverse proxy hops we trust to set X-Forwarded-For
     * (Caddy). NEVER `true`: a direct caller could otherwise spoof its IP and
     * bypass the venue allow-list.
     */
    TRUST_PROXY: csv.default(['127.0.0.1', '::1']),

    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    PII_ENCRYPTION_KEY: base64Key32,
    PHONE_HASH_PEPPER: z.string().min(32, 'must be at least 32 characters'),

    SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.SMS_PROVIDER === 'twilio') {
      for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'required when SMS_PROVIDER=twilio',
          });
      }
    }
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'console provider is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Print key names and reasons only — never echo values (they may be secrets).
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
