// Turns a results folder into the numbers for docs/load-test-report.md.
//   node load/report.mjs event [stress event-chaos …]
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, 'results');
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};
const f = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();

for (const name of process.argv.slice(2)) {
  const dir = path.join(root, name);
  const sum = JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const m = sum.metrics;
  const v = (k, s) => m[k]?.values?.[s] ?? 0;
  console.log(`\n## ${name}\n`);
  console.log(
    `- visitors that completed the whole journey: **${v('flow_ok', 'passes')} of ${v('flow_ok', 'passes') + v('flow_ok', 'fails')}**`,
  );
  console.log(
    `- requests: ${v('http_reqs', 'count')} (${f(v('http_reqs', 'rate'))}/s average); failed: ${v('http_req_failed', 'passes')} (${f(v('http_req_failed', 'rate') * 100, 2)} %)`,
  );
  console.log(
    `- API latency: p50 ${f(v('http_req_duration{kind:api}', 'med'))} ms, p95 ${f(v('http_req_duration{kind:api}', 'p(95)'))} ms, p99 ${f(v('http_req_duration{kind:api}', 'p(99)'))} ms, max ${f(v('http_req_duration{kind:api}', 'max'))} ms`,
  );
  console.log(
    `- vote latency: p50 ${f(v('http_req_duration{kind:vote}', 'med'))} ms, p95 ${f(v('http_req_duration{kind:vote}', 'p(95)'))} ms, p99 ${f(v('http_req_duration{kind:vote}', 'p(99)'))} ms, max ${f(v('http_req_duration{kind:vote}', 'max'))} ms`,
  );
  console.log(
    `- votes confirmed to visitors: ${v('votes_confirmed', 'count')}; retried after a gateway or network error (all calls): ${v('retries_all', 'count')}; confirmed as "already recorded" (idempotent retry): ${v('votes_already_recorded', 'count')}; never confirmed: ${v('votes_unconfirmed', 'count')}`,
  );

  // per endpoint and per 10-second bucket
  const byName = new Map();
  const buckets = new Map();
  let t0 = Infinity;
  const rl = createInterface({ input: createReadStream(path.join(dir, 'points.json')) });
  const rows = [];
  for await (const line of rl) {
    if (!line.includes('"type":"Point"')) continue;
    const o = JSON.parse(line);
    if (o.metric !== 'http_req_duration' && o.metric !== 'http_req_failed') continue;
    const t = Date.parse(o.data.time);
    t0 = Math.min(t0, t);
    rows.push([o.metric, t, o.data.value, o.data.tags]);
  }
  for (const [metric, t, val, tags] of rows) {
    if (tags.kind === 'feed') continue;
    const key = tags.name;
    const e = byName.get(key) ?? { d: [], fail: 0, n: 0 };
    const b = buckets.get(Math.floor((t - t0) / 10000)) ?? { d: [], fail: 0, n: 0 };
    if (metric === 'http_req_duration') {
      e.d.push(val);
      e.n++;
      b.d.push(val);
      b.n++;
    } else if (val === 1 && tags.expected_response !== 'true') {
      e.fail++;
      b.fail++;
    }
    byName.set(key, e);
    buckets.set(Math.floor((t - t0) / 10000), b);
  }
  console.log(
    '\n| endpoint | requests | p50 ms | p95 ms | p99 ms | max ms | failed |\n|---|---|---|---|---|---|---|',
  );
  for (const [k, e] of [...byName].sort((a, b) => b[1].n - a[1].n))
    console.log(
      `| ${k} | ${e.n} | ${f(pct(e.d, 50))} | ${f(pct(e.d, 95))} | ${f(pct(e.d, 99))} | ${f(Math.max(...e.d))} | ${e.fail} |`,
    );

  const events = existsSync(path.join(dir, 'timeline.json'))
    ? JSON.parse(readFileSync(path.join(dir, 'timeline.json'), 'utf8'))
    : [];
  if (events.some((e) => /KILL|START/.test(e.what))) {
    console.log(
      '\nTimeline (10 s buckets, seconds from the start of the run):\n\n| t (s) | requests | failed | p95 ms | event |\n|---|---|---|---|---|',
    );
    for (const [i, b] of [...buckets].sort((a, c) => a[0] - c[0])) {
      const ev = events
        .filter((e) => Math.floor(e.t / 10) === i)
        .map((e) => e.what)
        .join(', ');
      if (b.fail || ev)
        console.log(`| ${i * 10} | ${b.n} | ${b.fail} | ${f(pct(b.d, 95))} | ${ev} |`);
    }
  }

  // containers
  if (existsSync(path.join(dir, 'stats.ndjson'))) {
    const peak = {};
    for (const line of readFileSync(path.join(dir, 'stats.ndjson'), 'utf8').split('\n')) {
      const i = line.indexOf(' ');
      if (i < 0) continue;
      try {
        const j = JSON.parse(line.slice(i + 1));
        const cpu = parseFloat(j.CPUPerc);
        const mem = j.MemUsage.split('/')[0].trim();
        const mib = /GiB/.test(mem) ? parseFloat(mem) * 1024 : parseFloat(mem);
        const p = (peak[j.Name] ??= { cpu: 0, mem: 0 });
        p.cpu = Math.max(p.cpu, cpu);
        p.mem = Math.max(p.mem, mib);
      } catch {
        /* partial line */
      }
    }
    console.log(
      '\nPeak container usage (10 logical CPUs = up to 1000 %): ' +
        Object.entries(peak)
          .map(
            ([k, p]) =>
              `${k.replace('mc2026-', '').replace('-1', '')} ${f(p.cpu, 0)} % CPU / ${f(p.mem, 0)} MiB`,
          )
          .join('; '),
    );
  }

  // TVs
  if (existsSync(path.join(dir, 'tv.json'))) {
    const raw = JSON.parse(readFileSync(path.join(dir, 'tv.json'), 'utf8'));
    const tvs = Array.isArray(raw) ? raw : raw.tvs;
    const ver = existsSync(path.join(dir, 'verify.json'))
      ? JSON.parse(readFileSync(path.join(dir, 'verify.json'), 'utf8'))
      : null;
    const finals = new Set(tvs.map((t) => t.total));
    console.log(
      `\nTV screens: ${tvs.length}; frames received ${tvs.reduce((a, t) => a + t.frames, 0)}; longest gap between frames ${f(Math.max(...tvs.map((t) => t.maxGapMs)) / 1000)} s; reconnects ${tvs.reduce((a, t) => a + t.drops.length, 0)} (slowest recovery ${f(Math.max(0, ...tvs.flatMap((t) => t.drops.map((d) => d.recoveredMs))) / 1000)} s); refused ${tvs.reduce((a, t) => a + t.refused, 0)}; final total shown: ${[...finals].join(' / ')}${ver ? ` (database: ${ver.votesInDatabase})` : ''}`,
    );
    if (ver?.voteTimes && !Array.isArray(raw)) {
      const lags = [];
      for (const tv of tvs)
        for (const [n, at] of Object.entries(tv.marks ?? {}))
          if (ver.voteTimes[n]) lags.push(at - ver.voteTimes[n]);
      if (lags.length)
        console.log(
          `Vote → on screen (commit to frame, ${lags.length} samples): p50 ${f(pct(lags, 50) / 1000, 2)} s, p95 ${f(pct(lags, 95) / 1000, 2)} s, max ${f(Math.max(...lags) / 1000, 2)} s`,
        );
    }
  }
  if (existsSync(path.join(dir, 'verify.json'))) {
    const { voteTimes: _vt, ...ver } = JSON.parse(
      readFileSync(path.join(dir, 'verify.json'), 'utf8'),
    );
    console.log('\nDatabase check: ' + JSON.stringify(ver));
  }
}
