import { createHash, randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { pool, resetDb } from './helpers';

/** Where screenshots for visual review go (set TV_SHOTS=/some/dir); otherwise Playwright's own output. */
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${process.env.TV_SHOTS ?? 'test-results'}/tv-${name}.png` });

interface Seed {
  categories: { id: string; slug: string }[];
  /** exhibitors per category, in catalog order */
  byCategory: Map<string, string[]>;
}

let phoneSeq = 0;
async function seed(): Promise<Seed> {
  const cats = (
    await pool.query('SELECT id, slug FROM categories WHERE is_active ORDER BY sort_order, name_en')
  ).rows as { id: string; slug: string }[];
  const byCategory = new Map<string, string[]>();
  for (const c of cats) {
    const { rows } = await pool.query(
      `SELECT ec.exhibitor_id FROM exhibitor_categories ec JOIN exhibitors e ON e.id = ec.exhibitor_id
        WHERE ec.category_id = $1 AND e.is_active ORDER BY e.name_en`,
      [c.id],
    );
    byCategory.set(
      c.id,
      rows.map((r) => r.exhibitor_id),
    );
  }
  return { categories: cats, byCategory };
}

/** Casts `n` votes for an exhibitor straight into the database (each from its own throwaway visitor). */
async function vote(category: string, exhibitor: string, n: number) {
  for (let i = 0; i < n; i++) {
    const { rows } = await pool.query(
      `INSERT INTO visitors (name_enc, phone_enc, phone_hash, vote_consent_at, consent_version)
       VALUES ('x','x', lpad(to_hex($1::int), 64, '0'), now(), 'v') RETURNING id`,
      [7_000_000 + ++phoneSeq],
    );
    await pool.query(
      'INSERT INTO votes (visitor_id, category_id, exhibitor_id) VALUES ($1,$2,$3)',
      [rows[0].id, category, exhibitor],
    );
  }
}

async function newDisplay(label = 'E2E TV') {
  const token = `mcd_${randomBytes(32).toString('base64url')}`;
  const { rows } = await pool.query(
    'INSERT INTO display_tokens (label, token_hash) VALUES ($1, $2) RETURNING id',
    [label, createHash('sha256').update(token).digest('hex')],
  );
  return { token, id: rows[0].id as string };
}

async function recordStream(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __sse: string[]; __muted: boolean };
    w.__sse = [];
    w.__muted = false;
    const Orig = window.EventSource;
    window.EventSource = class extends Orig {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener('frame', (e) => w.__sse.push((e as MessageEvent<string>).data));
      }
      // While muted, the page hears nothing: the same as a cable pulled out of the TV (no error is raised).
      addEventListener(
        type: string,
        fn: EventListenerOrEventListenerObject,
        opts?: boolean | AddEventListenerOptions,
      ) {
        const wrapped = (e: Event) => {
          if (w.__muted) return;
          if (typeof fn === 'function') fn(e);
          else fn.handleEvent(e);
        };
        super.addEventListener(type, wrapped, opts);
      }
    } as typeof EventSource;
  });
}
/** An ISO-8601 UTC instant exactly as the API writes it (`toISOString()`), for hand-built snapshot JSON. */
const NOW_ISO = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
/** The board's category headings (one per column). */
const heads = (page: Page) => page.getByRole('heading', { level: 2 });
/** Row `n` (0 = the leader) of column `col` (0 = first category). */
const row = (page: Page, col: number, n: number) =>
  page.locator('section').nth(col).locator('li').nth(n);
/** The medals: gold, silver, bronze. Gold is deliberately not the brand yellow, which stays first place's block. */
const GOLD = 'rgb(224, 165, 38)';
const SILVER = 'rgb(200, 205, 214)';
const BRONZE = 'rgb(201, 122, 58)';

/** Every row: nothing a row contains may spill past the row's own edges (no clipped or overflowing names). */
const spill = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('section li')]
      .filter((li) => li.getAttribute('aria-hidden') !== 'true')
      .map((li) => {
        const box = li.getBoundingClientRect();
        let worst = 0;
        for (const el of li.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.height === 0) continue;
          worst = Math.max(
            worst,
            r.bottom - box.bottom,
            box.top - r.top,
            r.right - box.right,
            box.left - r.left,
          );
        }
        return { text: (li.textContent ?? '').slice(0, 40), worst: Math.round(worst) };
      })
      .filter((x) => x.worst > 1),
  );
const streamed = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sse: string[] }).__sse);

test.beforeEach(async () => {
  await resetDb();
  // The stress test adds categories and exhibitors; remove them so every test starts from the seed.
  await pool.query(`DELETE FROM categories WHERE slug LIKE 'extra-%'`);
  await pool.query(
    `DELETE FROM exhibitors WHERE name_en IN ('Plain Name') OR name_en LIKE 'The Extraordinarily%' OR name_en LIKE 'Wadi Rum Solar%' OR name_en LIKE '% Team'`,
  );
  await pool.query(
    `UPDATE settings SET results_visibility = 'LIVE', frozen_snapshot = NULL, frozen_at = NULL, revealed = '[]'`,
  );
  await pool.query('DELETE FROM display_tokens');
});

test('an unpaired TV asks for a code; a wrong one is refused, the right one pairs', async ({
  page,
}) => {
  const { token } = await newDisplay();
  await page.goto('/live');
  await expect(page.getByRole('heading', { name: /./ })).toHaveCount(0); // no stage yet
  await expect(page.getByText('اقتران هذه الشاشة', { exact: true })).toBeVisible();
  await shot(page, '00-pairing');

  await page.getByLabel(/رمز الشاشة/).fill('mcd_' + 'A'.repeat(43));
  await page.getByRole('button', { name: 'اقتران' }).click();
  await expect(page.getByRole('alert')).toContainText('الرمز غير صالح');

  await page.getByLabel(/رمز الشاشة/).fill(token);
  await page.getByRole('button', { name: 'اقتران' }).click();
  await expect(page.getByText('بانتظار أول صوت')).toBeVisible();
});

test('a network hiccup while pairing from the link is retried with the same token', async ({
  page,
}) => {
  const { token } = await newDisplay();
  let attempts = 0;
  await page.route('**/api/display/pair', (route) =>
    attempts++ === 0 ? route.abort() : route.continue(),
  );
  await page.goto(`/live#t=${token}`);
  await expect(page.getByText('بانتظار أول صوت')).toBeVisible({ timeout: 12_000 }); // the TV pairs by itself…
  expect(attempts).toBeGreaterThanOrEqual(2);
  expect(page.url()).not.toContain('mcd_'); // …although the secret left the address bar before the first try
});

test('pairing from an address the API does not allow says so, instead of "cannot reach the server"', async ({
  page,
}) => {
  const { token } = await newDisplay();
  // The API refuses a pairing POST from an address it does not list (CSRF origin check). A browser will not let a
  // script forge Origin, so the refusal is simulated here; the server side is covered by the origin-guard tests.
  await page.route('**/api/display/pair', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'CSRF_FAILED', message: 'Cross-site request refused' },
      }),
    }),
  );
  await page.goto(`/live#t=${token}`);
  await expect(page.getByRole('alert')).toContainText('هذا العنوان غير مسموح');
});

test('pairs from the link, waits for the first vote, then shows live standings that update at once', async ({
  page,
}) => {
  const s = await seed();
  const { token } = await newDisplay();
  await page.goto(`/live#t=${token}`);
  await expect(page.getByText('بانتظار أول صوت')).toBeVisible();
  expect(page.url()).not.toContain('mcd_'); // the secret leaves the address bar straight away
  await page.waitForTimeout(900);
  await shot(page, '01-waiting');

  const [a, b] = [s.categories[0]!, s.categories[1]!];
  const ex = s.byCategory.get(a.id)!;
  await vote(a.id, ex[0]!, 5);
  await vote(a.id, ex[1]!, 3);
  await vote(a.id, ex[2]!, 2);
  await vote(b.id, s.byCategory.get(b.id)![0]!, 4);
  await expect(heads(page).first()).toBeVisible();
  await expect(row(page, 0, 0)).toContainText('5');
  await page.waitForTimeout(1600); // let the cascade and count-ups settle
  await shot(page, '02-stage');

  const before = Date.now();
  await vote(a.id, ex[1]!, 4); // overtakes: 7 vs 5
  await expect(row(page, 0, 0)).toContainText('7', { timeout: 3000 });
  expect(Date.now() - before).toBeLessThan(3000);
  await page.waitForTimeout(1200);
  await shot(page, '03-overtake');
});

test('Blind Hour: frozen standings stay frozen while votes keep arriving, and the browser never receives them', async ({
  page,
}) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  const ex = s.byCategory.get(a.id)!;
  await vote(a.id, ex[0]!, 6);
  await vote(a.id, ex[1]!, 2);
  await recordStream(page);
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();

  // Freeze exactly as the service does: snapshot + mode in one statement, so the settings trigger notifies.
  await pool.query(
    `UPDATE settings SET results_visibility = 'FROZEN', frozen_at = now(),
       frozen_snapshot = jsonb_build_object('v',1,'takenAt', ${NOW_ISO}, 'voters', 8, 'categories', jsonb_build_array(
         jsonb_build_object('categoryId', $1::text, 'total', 8, 'rows', jsonb_build_array(
           jsonb_build_object('exhibitorId', $2::text, 'votes', 6), jsonb_build_object('exhibitorId', $3::text, 'votes', 2)))))`,
    [a.id, ex[0], ex[1]],
  );
  await expect(page.getByText('ساعة الترقّب').first()).toBeVisible();
  // The sealed standings themselves are on screen (6 and 2), not a blank "sealed" fallback.
  await expect(row(page, 0, 0)).toContainText('6');
  await expect(row(page, 0, 1)).toContainText('2');
  await page.waitForTimeout(1600);
  await shot(page, '04-frozen');
  await expect(page.locator('.tv-frost')).toHaveCount(1); // Blind Hour is marked by an icy rim

  await vote(a.id, ex[1]!, 41); // the room keeps voting: 43 for the runner-up
  await page.waitForTimeout(2500);
  // (the "sealed at 21:49" clock time is not a vote count)
  const body = (await page.locator('body').innerText()).replace(/\d{1,2}:\d{2}/g, '');
  expect(body).not.toMatch(/\b43\b|\b49\b/); // neither the new count nor the new total is on screen…
  const frames = (await streamed(page)).join('\n');
  expect(frames).not.toMatch(/"votes":43|"totalVotes":49/); // …and was never sent to this browser at all
  expect(frames).toContain('"mode":"FROZEN"');
});

test('Hidden: the sealed screen shows no vote numbers at all', async ({ page }) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  await vote(a.id, s.byCategory.get(a.id)![0]!, 12);
  await recordStream(page);
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();
  await pool.query(`UPDATE settings SET results_visibility = 'HIDDEN'`);
  await expect(page.getByText('النتائج مختومة')).toBeVisible();
  await page.waitForTimeout(1800);
  await shot(page, '05-sealed');
  const main = await page.getByRole('main').innerText();
  // The only digits left may be the clock-style countdown; no vote count of 12.
  expect(main).not.toMatch(/\b12\b/);
  const last = (await streamed(page)).at(-1)!;
  expect(last).not.toMatch(/"votes"|"total":\d|"totalVotes":\d/);
});

test('Reveal: a winner announced while watching plays the ceremony, then settles on the final standings', async ({
  page,
}) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  const ex = s.byCategory.get(a.id)!;
  await vote(a.id, ex[0]!, 9);
  await vote(a.id, ex[1]!, 6);
  await vote(a.id, ex[2]!, 3);
  await pool.query(`UPDATE settings SET results_visibility = 'REVEAL', revealed = '[]'`);
  await page.goto(`/live#t=${token}`);
  await expect(page.getByText('النتائج مختومة')).toBeVisible();

  await pool.query(
    `UPDATE settings SET revealed = jsonb_build_array(jsonb_build_object('categoryId', $1::text, 'total', 18,
       'revealedAt', ${NOW_ISO}, 'rows', jsonb_build_array(
         jsonb_build_object('exhibitorId', $2::text, 'votes', 9),
         jsonb_build_object('exhibitorId', $3::text, 'votes', 6),
         jsonb_build_object('exhibitorId', $4::text, 'votes', 3))))`,
    [a.id, ex[0], ex[1], ex[2]],
  );
  await expect(page.getByRole('status').filter({ hasText: 'والفائز هو' })).toBeVisible();
  const ceremony = page.locator('div.tv-dark[role="status"]'); // the curtain itself, whichever beat is showing

  // The curtain is opaque from its first frame to its last: it is never faded over the board.
  const seenOpacity = new Set<string>();
  for (const wait of [40, 120, 300, 900]) {
    await page.waitForTimeout(wait);
    seenOpacity.add(await ceremony.evaluate((el) => getComputedStyle(el).opacity));
  }
  expect([...seenOpacity]).toEqual(['1']);
  // Behind it the board is switched off for everyone (inert), and the announced category is still sealed there.
  await expect(page.locator('div[inert]')).toHaveCount(1);
  await expect(page.locator('div[inert] section').first()).toContainText('مختومة');
  await page.waitForTimeout(700);
  await shot(page, '06a-ceremony-announce');
  await page.waitForTimeout(2800); // the winner beat (from 2.6 s)
  await shot(page, '06b-ceremony-winner');
  await expect(ceremony).toContainText('أكوا فوغ');
  await page.waitForTimeout(7000); // the podium beat (from 10 s)
  await shot(page, '07-ceremony-podium');
  await expect(ceremony).toContainText('رفيق برايل');
  // The runners-up match the board: silver and bronze medals on light and dark glass; first place's count is the only yellow.
  await expect(ceremony.locator('[data-place="2"]')).toHaveCSS('background-color', SILVER);
  await expect(ceremony.locator('[data-place="3"]')).toHaveCSS('background-color', BRONZE);
  const ceremonyAxe = await new AxeBuilder({ page })
    .include('[role="status"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(ceremonyAxe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await expect(ceremony).toBeHidden({ timeout: 12_000 });
  await expect(heads(page).first()).toBeVisible();
  await expect(page.locator('div[inert]')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await shot(page, '08-revealed-final');
  await expect(row(page, 0, 0)).toContainText('9'); // the column unlocked with its final standings

  // A reload must not replay the ceremony.
  await page.reload();
  await expect(heads(page).first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'الفائز' })).toHaveCount(0);
});

test('revoking the display returns the TV to pairing and takes the results off the screen', async ({
  page,
}) => {
  const s = await seed();
  const { token, id } = await newDisplay();
  const a = s.categories[0]!;
  await vote(a.id, s.byCategory.get(a.id)![0]!, 3);
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();
  await pool.query('UPDATE display_tokens SET revoked_at = now() WHERE id = $1', [id]);
  await expect(page.getByText('اقتران هذه الشاشة', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('alert')).toContainText('أُلغي اقتران');
  await expect(heads(page)).toHaveCount(0);
});

test('copes with seven categories, very long names, a dark category colour and a three-way tie', async ({
  page,
}) => {
  // Four extra categories (one nearly the colour of the ground) …
  for (let i = 0; i < 4; i++) {
    await pool.query(
      `INSERT INTO categories (slug, name_en, name_ar, color, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `extra-${i}`,
        `Extra award category number ${i + 1}`,
        `فئة جائزة إضافية رقم ${i + 1}`,
        i === 0 ? '#05054a' : '#e0457b',
        10 + i,
      ],
    );
  }
  const first = (await pool.query('SELECT id FROM categories ORDER BY sort_order, name_en LIMIT 1'))
    .rows[0].id as string;
  // … and three exhibitors with names far longer than any row can hold, tied for first.
  const long = [
    [
      'The Extraordinarily Long Named Autonomous Greenhouse Robotics Collective of Amman',
      'مجموعة عمّان الطويلة جداً للروبوتات الزراعية المستقلة وأنظمة الري الذكية',
    ],
    [
      'Wadi Rum Solar-Powered Desalination & Community Water Project',
      'مشروع وادي رم لتحلية المياه بالطاقة الشمسية وخدمة المجتمع المحلي',
    ],
    ['Plain Name', null],
  ] as const;
  const ids: string[] = [];
  for (const [en, ar] of long) {
    const { rows } = await pool.query(
      'INSERT INTO exhibitors (name_en, name_ar) VALUES ($1,$2) RETURNING id',
      [en, ar],
    );
    await pool.query(
      'INSERT INTO exhibitor_categories (exhibitor_id, category_id) VALUES ($1,$2)',
      [rows[0].id, first],
    );
    ids.push(rows[0].id);
  }
  for (const id of ids) await vote(first, id, 4);
  // Categories on later pages also have votes.
  for (const [slug, n] of [
    ['extra-1', 3],
    ['extra-2', 2],
  ] as const) {
    const cat = (await pool.query('SELECT id FROM categories WHERE slug = $1', [slug])).rows[0]
      .id as string;
    const { rows } = await pool.query(
      'INSERT INTO exhibitors (name_en, name_ar) VALUES ($1,$2) RETURNING id',
      [`Leader of ${slug} Team`, null],
    );
    await pool.query(
      'INSERT INTO exhibitor_categories (exhibitor_id, category_id) VALUES ($1,$2)',
      [rows[0].id, cat],
    );
    await vote(cat, rows[0].id, n);
  }
  const { token } = await newDisplay();
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();
  await page.waitForTimeout(1800);
  // Three-way tie: three leader rows share first place in the first column.
  await expect(page.locator('section').first().locator('li.bg-yellow')).toHaveCount(3);
  // Seven categories do not squeeze into one screen: three columns at a time, with page dots.
  await expect(page.locator('section')).toHaveCount(3);
  await shot(page, '09-stress');
  // Every name is shown in full: no ellipsis anywhere, and nothing spills out of its row.
  const names = await page.locator('section').first().innerText();
  expect(names).not.toContain('…');
  expect(names).toContain('Autonomous Greenhouse Robotics Collective of Amman');
  expect(names).toContain('Community Water Project');
  expect(await spill(page)).toEqual([]);
  const overflowing = await page.evaluate(
    () =>
      [...document.querySelectorAll('li, h2, footer *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1;
      }).length,
  );
  expect(overflowing).toBe(0);
});

test('scales to a 4K TV, a laptop mirror and a non-16:9 monitor without distortion or cropping', async ({
  page,
}) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  await vote(a.id, s.byCategory.get(a.id)![0]!, 5);
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();
  for (const [w, h] of [
    [3840, 2160],
    [1366, 768],
    [1280, 1024],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const r = document.querySelector('main')!.parentElement!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(box.w / box.h).toBeCloseTo(16 / 9, 2); // never stretched
    expect(box.x).toBeGreaterThanOrEqual(-1); // never cropped
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.w).toBeLessThanOrEqual(w + 1);
    expect(box.y + box.h).toBeLessThanOrEqual(h + 1);
    if (w === 1280) await shot(page, '10-letterbox-5x4');
  }
});

test('silent link: the last numbers stay, a notice appears, and it clears as soon as the link is back', async ({
  page,
}) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  const ex = s.byCategory.get(a.id)!;
  await vote(a.id, ex[0]!, 6);
  await pool.query(
    `UPDATE settings SET results_visibility = 'FROZEN', frozen_at = now(),
       frozen_snapshot = jsonb_build_object('v',1,'takenAt', ${NOW_ISO}, 'voters', 6, 'categories', jsonb_build_array(
         jsonb_build_object('categoryId', $1::text, 'total', 6, 'rows', jsonb_build_array(
           jsonb_build_object('exhibitorId', $2::text, 'votes', 6)))))`,
    [a.id, ex[0]],
  );
  await recordStream(page);
  await page.goto(`/live#t=${token}`);
  await expect(page.getByText('ساعة الترقّب').first()).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __muted: boolean }).__muted = true));
  await page.waitForTimeout(500);
  await expect(page.getByRole('status')).toHaveCount(0); // a blip is not announced to the room
  const chip = page.getByRole('status').filter({ hasText: 'إعادة الاتصال' });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(heads(page).first()).toBeVisible(); // never a blank screen
  await expect(row(page, 0, 0)).toContainText('6');
  await shot(page, '11-offline-frozen');
  await page.evaluate(() => ((window as unknown as { __muted: boolean }).__muted = false));
  await expect(chip).toBeHidden({ timeout: 15_000 }); // the next heartbeat (5 s) clears it
});

test('silent link over a LIVE frame: the notice fits beside the LIVE pill and the vote counter', async ({
  page,
}) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  await vote(a.id, s.byCategory.get(a.id)![0]!, 5);
  await pool.query(`UPDATE settings SET voting_closes_at = now() + interval '2 hours'`);
  await recordStream(page);
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __muted: boolean }).__muted = true));
  const chip = page.getByRole('status').filter({ hasText: 'إعادة الاتصال' });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await shot(page, '13-offline-live');
  const header = await page.locator('main header').first().boundingBox();
  const boxes = await page
    .locator('main header:first-of-type > div > *')
    .evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })),
    );
  expect(header).not.toBeNull();
  // Nothing in the header runs past the artboard edge.
  for (const b of boxes) {
    expect(b.l).toBeGreaterThanOrEqual(0);
    expect(b.r).toBeLessThanOrEqual(1921);
  }
  await pool.query(`UPDATE settings SET voting_closes_at = NULL`);
});

test('a five-way tie for first names every co-winner in the ceremony', async ({ page }) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  const ids: string[] = [];
  for (const n of ['Alpha Team', 'Beta Team', 'Gamma Team', 'Delta Team', 'Epsilon Team']) {
    const { rows } = await pool.query(
      'INSERT INTO exhibitors (name_en, name_ar) VALUES ($1,$2) RETURNING id',
      [n, null],
    );
    await pool.query(
      'INSERT INTO exhibitor_categories (exhibitor_id, category_id) VALUES ($1,$2)',
      [rows[0].id, a.id],
    );
    ids.push(rows[0].id);
  }
  for (const id of ids) await vote(a.id, id, 3);
  await pool.query(`UPDATE settings SET results_visibility = 'REVEAL', revealed = '[]'`);
  await page.goto(`/live#t=${token}`);
  await expect(page.getByText('النتائج مختومة')).toBeVisible();
  await pool.query(
    `UPDATE settings SET revealed = jsonb_build_array(jsonb_build_object('categoryId', $1::text, 'total', 15,
       'revealedAt', ${NOW_ISO}, 'rows', (SELECT jsonb_agg(jsonb_build_object('exhibitorId', x, 'votes', 3)) FROM unnest($2::text[]) AS x)))`,
    [a.id, ids],
  );
  const ceremony = page.getByRole('status').filter({ hasText: 'الفائزون بالتساوي' });
  await expect(ceremony).toBeVisible();
  await page.waitForTimeout(4200); // joint winners show from 2.6 s
  for (const n of ['Alpha Team', 'Beta Team', 'Gamma Team', 'Delta Team', 'Epsilon Team'])
    await expect(ceremony).toContainText(n);
  await shot(page, '12-ceremony-five-way-tie');
});

test('places read at a glance: yellow is first place and nothing else, second a light glass with a white medal, third darker glass', async ({
  page,
}) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  const b = s.categories[1]!;
  const ex = s.byCategory.get(a.id)!;
  await vote(a.id, ex[0]!, 6);
  await vote(a.id, ex[1]!, 4);
  await vote(a.id, ex[2]!, 2);
  await vote(b.id, s.byCategory.get(b.id)![0]!, 3);
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();
  await page.waitForTimeout(2200);
  await shot(page, '14-places');
  await expect(page.locator('.tv-frost')).toHaveCount(0); // live voting has no freeze effect
  // The QR is large and centred under the board.
  const qr = (await page
    .getByRole('img', { name: /امسح|Scan/ })
    .first()
    .boundingBox())!;
  expect(qr.width).toBeGreaterThanOrEqual(180);
  expect(Math.abs(qr.x + qr.width / 2 - 960)).toBeLessThan(12); // dead centre (the anti burn-in drift moves the picture by up to 7px)

  const YELLOW = 'rgb(248, 215, 73)';
  const found = await page.evaluate((yellow) => {
    const out: { place: string; where: string }[] = [];
    for (const el of document.querySelectorAll('main *')) {
      const cs = getComputedStyle(el);
      const isYellow =
        cs.backgroundColor === yellow ||
        cs.color === yellow ||
        (cs.borderTopColor === yellow && cs.borderTopWidth !== '0px');
      if (!isYellow) continue;
      const li = el.closest('li');
      const place = li?.querySelector('[data-place]')?.getAttribute('data-place') ?? 'none';
      out.push({ place, where: li ? 'row' : el.tagName.toLowerCase() });
    }
    return out;
  }, YELLOW);
  // Every yellow thing on the board sits inside a first-place row (and inside a header/pill only if it is one).
  expect(found.length).toBeGreaterThan(0);
  for (const f of found) expect(f, JSON.stringify(f)).toMatchObject({ where: 'row', place: '1' });

  // The ladder: first a yellow block, second a white block, third pale glass (neither yellow nor white);
  // the medals are gold, silver and bronze with navy numerals.
  const block = async (place: string) =>
    page
      .locator(`section li:has([data-place="${place}"])`)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await block('1')).toBe('rgb(248, 215, 73)');
  // Only first place is a solid colour: second and third are translucent glass, second the lighter of the two.
  const alpha = (c: string) => Number(c.match(/([\d.]+)\)$/)?.[1] ?? 1);
  expect(alpha(await block('2'))).toBeGreaterThan(alpha(await block('3')));
  expect(alpha(await block('2'))).toBeLessThan(0.5);
  const badge = async (place: string) =>
    page
      .locator(`section [data-place="${place}"]`)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await badge('1')).toBe(GOLD);
  expect(await badge('2')).toBe(SILVER);
  expect(await badge('3')).toBe(BRONZE);
  // The podium steps down: first is taller than second, second than third.
  const heights = await page
    .locator('section')
    .first()
    .locator('li')
    .evaluateAll((els) => els.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(heights[0]!).toBeGreaterThan(heights[1]!);
  expect(heights[1]!).toBeGreaterThan(heights[2]!);
  // Every column's podium lines up with its neighbours: same top and height for first, second and third,
  // whether the place is filled or still an open slot.
  const grid = await page.locator('section').evaluateAll((cols) =>
    cols.map((c) =>
      [...c.querySelectorAll('li')].slice(0, 3).map((li) => {
        const r = li.getBoundingClientRect();
        return `${Math.round(r.top)}:${Math.round(r.height)}`;
      }),
    ),
  );
  expect(grid[1]).toEqual(grid[0]);
  expect(grid[2]).toEqual(grid[0]);
});

test('the live stage has no accessibility violations (contrast included)', async ({ page }) => {
  const s = await seed();
  const { token } = await newDisplay();
  const a = s.categories[0]!;
  const ex = s.byCategory.get(a.id)!;
  await vote(a.id, ex[0]!, 5);
  await vote(a.id, ex[1]!, 3);
  await page.goto(`/live#t=${token}`);
  await expect(heads(page).first()).toBeVisible();
  await page.waitForTimeout(1800);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
