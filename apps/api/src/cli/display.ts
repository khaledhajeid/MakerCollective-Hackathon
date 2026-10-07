/**
 * Operator tool for TV displays (the admin "Displays" page in Phase 6 uses the same service).
 *   pnpm --filter @mc/api ops:display create "Main hall"   → prints the pairing URL ONCE
 *   pnpm --filter @mc/api ops:display list
 *   pnpm --filter @mc/api ops:display revoke <id>
 * In the Docker stack: pnpm stack:display create "Main hall"
 */
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { DisplayTokenService } from '../modules/display/tokens.js';

const actor = { adminId: null, label: 'cli:operator' };
const [cmd, arg] = process.argv.slice(2);

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, 1);
const tokens = new DisplayTokenService(db);

try {
  if (cmd === 'create' && arg) {
    const { id, token } = await tokens.create(arg.slice(0, 80), actor);
    const url = `${env.PUBLIC_ORIGIN.replace(/\/$/, '')}/live#t=${token}`;
    console.log(`\nDisplay "${arg}" created (id ${id}).\n`);
    console.log('Open this on the TV. It is shown only once — it is stored only as a hash:\n');
    console.log(`  ${url}\n`);
    console.log('(The part after # never leaves the TV browser except to pair once.)');
  } else if (cmd === 'list') {
    const rows = await tokens.list();
    if (!rows.length) console.log('no displays yet');
    for (const r of rows)
      console.log(
        `${r.id}  ${r.revokedAt ? 'REVOKED' : 'active '}  ${r.label}  last seen: ${r.lastSeenAt?.toISOString() ?? 'never'}`,
      );
  } else if (cmd === 'revoke' && arg) {
    console.log((await tokens.revoke(arg, actor)) ? 'revoked' : 'no such active display');
  } else {
    console.error('usage: display create <label> | list | revoke <id>');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
