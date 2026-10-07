// Load-test helper (NOT part of the product): lets k6 read the one-time code the demo SMS inbox "sent".
// k6 cannot query Postgres, and the real flow needs the code, so this tiny local server answers
//   GET /otp?to=<masked phone>&since=<epoch ms>   →  { code }  (404 until the message exists)
// It reads `sms_outbox` over the loopback-only database port. It exists only on the tester's laptop.
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const pg = require('pg');
const { DATABASE_URL, PORT = '8099' } = process.env;
if (!DATABASE_URL)
  throw new Error(
    'DATABASE_URL (host-side, e.g. postgres://mc:…@127.0.0.1:55432/mc_load) is required',
  );

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/otp') return res.writeHead(404).end();
    const to = u.searchParams.get('to') ?? '';
    const since = Number(u.searchParams.get('since') ?? 0);
    try {
      const { rows } = await pool.query(
        'select body from sms_outbox where to_masked = $1 and created_at >= to_timestamp($2 / 1000.0) order by created_at desc limit 1',
        [to, since],
      );
      const m = rows[0]?.body.match(/code: (\d{4,8})/);
      if (!m) return res.writeHead(404).end();
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ code: m[1] }));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  })
  .listen(Number(PORT), '0.0.0.0', () => console.log(`otp-feed on :${PORT}`));
