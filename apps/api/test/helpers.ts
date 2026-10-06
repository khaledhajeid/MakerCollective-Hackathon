import { randomBytes } from 'node:crypto';
import { loadEnv, type Env } from '../src/config/env.js';

/** A complete, valid test environment with throwaway secrets. */
export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgres://mc:mc@localhost:5432/mc_test',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PHONE_HASH_PEPPER: randomBytes(32).toString('hex'),
    ...overrides,
  });
}
