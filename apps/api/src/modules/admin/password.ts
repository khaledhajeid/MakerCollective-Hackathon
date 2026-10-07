import { argon2 as argon2Callback, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PASSWORD_MAX, PASSWORD_MIN } from '@mc/shared';

const argon2 = promisify(argon2Callback);

/**
 * Admin passwords: argon2id (RFC 9106) from Node's own crypto module, so there is no native add-on to build or
 * to supply-chain. 64 MiB / 3 passes costs ≈150 ms here: invisible to an admin signing in, ruinous to a
 * guessing rig. The cost parameters are stored inside every hash (PHC string), so raising them later needs no
 * migration: `needsRehash` lets the next successful sign-in upgrade an old hash.
 */
const COST = { memory: 65_536, passes: 3, parallelism: 1 } as const;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
/** Concurrent hashes are capped: each holds 64 MiB, and sign-ins are rare but attacker-triggerable. */
const MAX_CONCURRENT = 2;
/** A stored hash is trusted data, but its cost fields are still bounded so a corrupt row cannot exhaust memory. */
const BOUNDS = { memory: 262_144, passes: 10, parallelism: 4 } as const;

let running = 0;
const waiting: Array<() => void> = [];
async function gated<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
const unb64 = (s: string) => Buffer.from(s, 'base64');

/** NFKC so the same password typed on two keyboards/devices is the same password (NIST SP 800-63B §5.1.1.2). */
const prepare = (password: string) => Buffer.from(password.normalize('NFKC'), 'utf8');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await gated(() =>
    argon2('argon2id', {
      message: prepare(password),
      nonce: salt,
      tagLength: TAG_BYTES,
      ...COST,
    }),
  );
  return `$argon2id$v=19$m=${COST.memory},t=${COST.passes},p=${COST.parallelism}$${b64(salt)}$${b64(tag)}`;
}

interface Parsed {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function parse(phc: string): Parsed | null {
  const m = PHC.exec(phc);
  if (!m) return null;
  const memory = Number(m[1]);
  const passes = Number(m[2]);
  const parallelism = Number(m[3]);
  if (
    memory < 8 * parallelism ||
    memory > BOUNDS.memory ||
    passes < 1 ||
    passes > BOUNDS.passes ||
    parallelism < 1 ||
    parallelism > BOUNDS.parallelism
  )
    return null;
  const salt = unb64(m[4]!);
  const tag = unb64(m[5]!);
  if (salt.length < 8 || tag.length < 16) return null;
  return { memory, passes, parallelism, salt, tag };
}

/** Constant-time check. An unparseable stored hash simply fails (it never throws into a login path). */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const p = parse(phc);
  if (!p || password.length > PASSWORD_MAX * 2) return false;
  const tag = await gated(() =>
    argon2('argon2id', {
      message: prepare(password),
      nonce: p.salt,
      tagLength: p.tag.length,
      memory: p.memory,
      passes: p.passes,
      parallelism: p.parallelism,
    }),
  );
  return timingSafeEqual(tag, p.tag);
}

export function needsRehash(phc: string): boolean {
  const p = parse(phc);
  return (
    !p || p.memory !== COST.memory || p.passes !== COST.passes || p.parallelism !== COST.parallelism
  );
}

let dummy: Promise<string> | null = null;
/**
 * A real hash of a throw-away secret. Signing in as an unknown (or locked) account still pays one full
 * verification against this, so response time never reveals whether a username exists.
 */
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword(randomBytes(24).toString('base64')));
}

/* ───────────── policy ───────────── */

export type PasswordProblem =
  'too_short' | 'too_long' | 'common' | 'contains_username' | 'repeated' | 'same_as_current';

/** Length, not composition rules (NIST SP 800-63B), plus a short list of what attackers try first. */
const COMMON = new Set([
  'password',
  'passw0rd',
  'letmein',
  'welcome',
  'iloveyou',
  'qwerty',
  'qwertyuiop',
  'administrator',
  'adminadmin',
  'changeme',
  'trustno',
  'abc',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'master',
  'shadow',
  'superman',
  'sunshine',
  'princess',
  'login',
  'starwars',
  'makercollective',
  'makerspace',
  'cpfmakerspace',
  'maker',
  'alrabeta',
  'amman',
  'jordan',
  'hackathon',
]);

export function checkPassword(
  password: string,
  context: { username: string; sameAs?: string },
): PasswordProblem | null {
  const chars = [...password.normalize('NFKC')];
  if (chars.length < PASSWORD_MIN) return 'too_short';
  if (chars.length > PASSWORD_MAX) return 'too_long';
  const lower = password.normalize('NFKC').toLowerCase();
  if (new Set(chars).size < 4) return 'repeated';
  if (lower.includes(context.username.toLowerCase())) return 'contains_username';
  // "Password123!" and "p-a-s-s-w-o-r-d" are the same guess to an attacker: judge the letters only.
  const letters = lower.replace(/[^a-z]/g, '');
  for (const word of COMMON)
    if (
      letters === word ||
      (word.length >= 6 && letters.startsWith(word) && letters.length <= word.length + 2)
    )
      return 'common';
  if (context.sameAs !== undefined && context.sameAs === password) return 'same_as_current';
  return null;
}

/** Operator-issued temporary passwords: ≈ 114 bits, no look-alike characters (read aloud / typed from a terminal). */
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generatePassword(length = 20): string {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}
