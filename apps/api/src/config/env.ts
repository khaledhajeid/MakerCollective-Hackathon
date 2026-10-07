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
    /** Migrate step only: password of the least-privilege `mc_app` role it provisions (ADR-009). */
    APP_DB_PASSWORD: z.string().min(24, 'must be at least 24 characters').optional(),
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

    /** Extra browser origins allowed to call mutating endpoints (e.g. http://localhost:8080 for local checks). */
    EXTRA_ORIGINS: csv.default([]),

    /** ADR-004. `console` and `demo-inbox` expose OTPs and need DEMO_MODE=true in production. */
    SMS_PROVIDER: z.enum(['console', 'demo-inbox', 'http']).default('console'),
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** `http` adapter — the organisers' own SMS gateway (no code change needed). */
    SMS_HTTP_URL: z.url().optional(),
    /** Full header line, e.g. `Authorization: Bearer abc`. Optional. */
    SMS_HTTP_AUTH_HEADER: z.string().optional(),
    /** JSON with "{to}" and "{message}" placeholders in string values. */
    SMS_HTTP_BODY_TEMPLATE: z.string().optional(),
    SMS_HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(20_000).default(5_000),

    /** Hard ceiling on OTP SMS per hour across the whole event (SMS-pumping / cost control). */
    OTP_GLOBAL_PER_HOUR: z.coerce.number().int().min(10).max(100_000).default(4_000),
  })
  .superRefine((env, ctx) => {
    if (env.SMS_PROVIDER === 'http') {
      for (const key of ['SMS_HTTP_URL', 'SMS_HTTP_BODY_TEMPLATE'] as const) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'required when SMS_PROVIDER=http' });
      }
      if (env.SMS_HTTP_BODY_TEMPLATE) {
        try {
          JSON.parse(env.SMS_HTTP_BODY_TEMPLATE);
        } catch {
          ctx.addIssue({
            code: 'custom',
            path: ['SMS_HTTP_BODY_TEMPLATE'],
            message: 'must be valid JSON',
          });
        }
      }
      if (
        env.NODE_ENV === 'production' &&
        env.SMS_HTTP_URL &&
        !env.SMS_HTTP_URL.startsWith('https://')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['SMS_HTTP_URL'],
          message: 'must be https in production',
        });
    }
    // OTPs must never be readable by visitors at the real event: demo adapters are an explicit opt-in.
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER !== 'http' && !env.DEMO_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: `${env.SMS_PROVIDER} exposes OTPs and needs DEMO_MODE=true in production (use SMS_PROVIDER=http for the real event)`,
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` lines (as generated into .env / .env.example) mean "unset", not "empty value".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Print key names and reasons only — never echo values (they may be secrets).
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
