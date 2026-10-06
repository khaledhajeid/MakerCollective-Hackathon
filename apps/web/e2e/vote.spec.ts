import { expect, test } from '@playwright/test';
import { T, localeOf, pool, resetDb, settle, signIn, voteInNextCategory } from './helpers';

test.beforeEach(async () => {
  await resetDb();
  await settle(); // cached settings from the previous test must expire
});

test('a visitor signs in with an SMS code and votes in every category (F2 F3 F5 F6)', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await signIn(page, locale);

  const categories = await page.getByText(t.choose).count();
  expect(categories).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < categories; i++) {
    await voteInNextCategory(page, locale);
    // Back on the hub (or on the finish screen after the last vote) once the success moment has played.
    if (i < categories - 1) await expect(page.getByRole('heading', { name: t.hub })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: t.thanks })).toBeVisible();

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n, count(DISTINCT category_id)::int AS c FROM votes',
  );
  expect(rows[0]).toEqual({ n: categories, c: categories });

  // The session and the recorded votes survive a reload: still signed in, still on the thank-you screen.
  await page.reload();
  await expect(page.getByRole('heading', { name: t.thanks })).toBeVisible();
  await page.getByRole('button', { name: t.review }).click();
  await expect(page.getByRole('heading', { name: t.hub })).toBeVisible();
  await expect(page.getByText(t.choose)).toHaveCount(0);
});

test('a wrong code is refused with a clear message, then the right one works (F6)', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);
  await page.goto('/vote');
  await page.getByRole('button', { name: t.start }).click();
  await page.getByLabel(t.name).fill('Omar');
  await page.getByLabel(t.phone).fill('791112233');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: t.send }).click();
  const input = page.getByLabel(t.code);
  const { latestCode } = await import('./helpers');
  const right = await latestCode();
  await input.fill(right === '000000' ? '111111' : '000000');
  await expect(page.getByText(t.wrongCode)).toBeVisible();
  await input.fill(right);
  await expect(page.getByRole('heading', { name: t.hub })).toBeVisible();
});

test('consent is required before a code is sent', async ({ page }, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);
  await page.goto('/vote');
  await page.getByRole('button', { name: t.start }).click();
  await page.getByLabel(t.name).fill('Omar');
  await page.getByLabel(t.phone).fill('791112233');
  await page.getByRole('button', { name: t.send }).click();
  await expect(page.getByText(t.consentErr).first()).toBeVisible();
  expect((await pool.query('SELECT count(*)::int AS n FROM sms_outbox')).rows[0].n).toBe(0);
});

test('votes are final: the category locks and the API refuses a different choice (decision #2)', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await signIn(page, locale);
  await voteInNextCategory(page, locale);
  await expect(page.getByRole('heading', { name: t.hub })).toBeVisible();

  const { rows } = await pool.query(
    `SELECT v.category_id, v.exhibitor_id, (SELECT ec.exhibitor_id FROM exhibitor_categories ec
       WHERE ec.category_id = v.category_id AND ec.exhibitor_id <> v.exhibitor_id LIMIT 1) AS other FROM votes v`,
  );
  const res = await page.request.post('/api/votes', {
    data: { categoryId: rows[0].category_id, exhibitorId: rows[0].other },
    headers: { origin: 'http://localhost:5180' },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).error.code).toBe('ALREADY_VOTED');

  // In the UI the recorded category shows the pick and offers no second vote.
  await page.getByRole('button').filter({ hasText: t.yourVote }).first().click();
  await expect(page.getByText(t.final)).toBeVisible();
  await expect(page.locator('button[disabled]').first()).toBeVisible();
  expect((await pool.query('SELECT count(*)::int AS n FROM votes')).rows[0].n).toBe(1);
});

test('losing the connection mid-vote never shows a false "recorded", and the vote lands once it returns', async ({
  page,
  context,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await signIn(page, locale);
  await page.getByText(t.choose).first().click();
  await page
    .locator('button')
    .filter({ has: page.locator('img, svg[viewBox="0 0 160 100"]') })
    .first()
    .click();
  await context.setOffline(true);
  await page.getByRole('dialog').getByRole('button', { name: t.confirm }).click();
  await expect(page.getByText(t.waiting)).toBeVisible();
  await expect(page.getByRole('heading', { name: t.recorded })).toHaveCount(0);
  expect((await pool.query('SELECT count(*)::int AS n FROM votes')).rows[0].n).toBe(0);
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: t.recorded })).toBeVisible({ timeout: 15_000 });
  expect((await pool.query('SELECT count(*)::int AS n FROM votes')).rows[0].n).toBe(1);
});

test('off the venue network the app says which Wi-Fi to join, and recovers once on it (F10 F11)', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await resetDb();
  await pool.query(
    `UPDATE settings SET access_mode = 'IP_ALLOWLIST', venue_cidrs = '{203.0.113.0/24}'`,
  );
  await settle();
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);
  await page.goto('/vote');
  await expect(page.getByRole('heading', { name: t.gate })).toBeVisible();
  await expect(page.getByText('MC2026')).toBeVisible();
  await expect(page.getByRole('button', { name: t.start })).toHaveCount(0);

  await pool.query(`UPDATE settings SET access_mode = 'OFF'`);
  await settle();
  await page.getByRole('button', { name: t.retry }).click();
  await expect(page.getByRole('button', { name: t.start })).toBeVisible();
});

test('when voting is closed visitors see a clear closed screen, not a broken flow (F9)', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await pool.query(`UPDATE settings SET voting_status = 'CLOSED'`);
  await settle();
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);
  await page.goto('/vote');
  await expect(page.getByRole('heading', { name: t.closed })).toBeVisible();
  await expect(page.getByRole('button', { name: t.start })).toHaveCount(0);
});

test('the language toggle flips direction and text instantly and is remembered', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  await page.goto('/vote');
  await page.evaluate((l) => localStorage.setItem('mc_locale', l), locale);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
  await page.getByRole('button', { name: locale === 'ar' ? 'English' : 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'ltr' : 'rtl');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ar' ? 'en' : 'ar');
});

test('coming back to the tab refreshes data without yanking the visitor to the top of the list', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await signIn(page, locale);
  await page.getByText(t.choose).first().click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 500));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(300);
  // What a phone does when the visitor returns from the Messages app: visibilitychange → refetch catalog + status.
  const refetched = page.waitForResponse((r) => r.url().includes('/api/catalog'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await refetched;
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 40);
});

test('a session that ends mid-vote explains itself instead of silently restarting', async ({
  page,
}, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await signIn(page, locale);
  await page.getByText(t.choose).first().click();
  await page
    .locator('button')
    .filter({ has: page.locator('img, svg[viewBox="0 0 160 100"]') })
    .first()
    .click();
  // The organiser (or a logout elsewhere) revokes the visitor's sessions while the sheet is open.
  await pool.query(`UPDATE visitors SET sessions_revoked_at = now() + interval '1 minute'`);
  await page.getByRole('dialog').getByRole('button', { name: t.confirm }).click();
  await expect(page.getByRole('button', { name: t.start })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(t.sessionEnded)).toBeVisible();
  expect((await pool.query('SELECT count(*)::int AS n FROM votes')).rows[0].n).toBe(0);
});
