#!/usr/bin/env node
// Starts the full stack + Cloudflare tunnel, refusing to start without a tunnel token
// (otherwise cloudflared would just crash and the QR URL would show Cloudflare error 1033).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const envFile = new URL('../.env', import.meta.url);
if (!existsSync(envFile)) {
  console.error('No .env — run: node scripts/gen-env.mjs');
  process.exit(1);
}
process.loadEnvFile(envFile);
if (!process.env.CLOUDFLARE_TUNNEL_TOKEN?.trim()) {
  console.error(
    'CLOUDFLARE_TUNNEL_TOKEN is empty in .env (Cloudflare Zero Trust → Networks → Tunnels).',
  );
  process.exit(1);
}
execFileSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infra/docker-compose.yml',
    '--profile',
    'full',
    '--profile',
    'tunnel',
    'up',
    '-d',
    '--build',
  ],
  { stdio: 'inherit', cwd: new URL('..', import.meta.url) },
);
