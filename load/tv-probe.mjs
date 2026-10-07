// Load-test helper: N "TV screens" holding the live results stream open for the whole run, like the real displays.
//   node load/tv-probe.mjs <baseUrl> <tokens.json> <seconds> <out.json>
// Records, per TV: frames received, the longest gap between frames, drops and how long each took to recover,
// and a once-a-second series of the vote total it was showing, so the report can say how far behind the
// screens ever were. Reconnects like EventSource does (retry: 2000 ms).
import { readFileSync, writeFileSync } from 'node:fs';

const [base, tokensFile, secs, outFile] = process.argv.slice(2);
const tokens = JSON.parse(readFileSync(tokensFile, 'utf8'));
const stopAt = Date.now() + Number(secs) * 1000;
const origin = process.env.ORIGIN ?? 'http://localhost:8080';
const t0 = Date.now();

const tvs = tokens.map((token, i) => ({
  i,
  token,
  frames: 0,
  last: 0,
  maxGapMs: 0,
  drops: [],
  total: null,
  marks: {}, // vote count -> when this TV first showed at least that many
  series: [],
  refused: 0,
}));

async function pair(tv) {
  const r = await fetch(`${base}/api/display/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ token: tv.token }),
  });
  if (!r.ok) throw new Error(`pair ${r.status}`);
  tv.cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function run(tv) {
  await pair(tv);
  let droppedAt = 0;
  while (Date.now() < stopAt) {
    try {
      const r = await fetch(`${base}/api/display/stream`, {
        headers: { cookie: tv.cookie, accept: 'text/event-stream' },
      });
      if (!r.ok) {
        tv.refused++;
        throw new Error(String(r.status));
      }
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k);
          buf = buf.slice(k + 2);
          if (!block.startsWith('event: frame')) continue;
          const now = Date.now();
          if (droppedAt) {
            tv.drops.push({ at: droppedAt - t0, recoveredMs: now - droppedAt });
            droppedAt = 0;
          }
          if (tv.last) tv.maxGapMs = Math.max(tv.maxGapMs, now - tv.last);
          tv.last = now;
          tv.frames++;
          const data = JSON.parse(
            block
              .split('\n')
              .find((l) => l.startsWith('data: '))
              .slice(6),
          );
          const prev = tv.total ?? 0;
          tv.total = data.totalVotes;
          if (typeof tv.total === 'number')
            for (let n = Math.floor(prev / 50) * 50 + 50; n <= tv.total; n += 50)
              tv.marks[n] ??= now;
        }
        if (Date.now() > stopAt) break;
      }
    } catch {
      /* fall through to reconnect */
    }
    if (Date.now() >= stopAt) break;
    droppedAt ||= Date.now();
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 500));
  }
}

const tick = setInterval(() => {
  const now = Date.now() - t0;
  for (const tv of tvs) tv.series.push([Math.round(now / 1000), tv.total]);
}, 1000);

await Promise.allSettled(tvs.map(run));
clearInterval(tick);
writeFileSync(
  outFile,
  JSON.stringify(
    { startedAt: t0, tvs: tvs.map(({ token: _t, cookie: _c, ...rest }) => rest) },
    null,
    1,
  ),
);
console.log(
  `tv-probe: ${tvs.length} screens, ${tvs.reduce((a, t) => a + t.frames, 0)} frames, ${tvs.reduce((a, t) => a + t.drops.length, 0)} drops`,
);
