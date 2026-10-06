import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  T,
  latestCode,
  localeOf,
  pool,
  randomPhone,
  resetDb,
  settle,
  signIn,
  voteInNextCategory,
} from './helpers';

test.beforeEach(async () => {
  await resetDb();
  await settle();
});

/** WCAG 2.2 A/AA rules, run on the rendered screen. Colour contrast is included (the brand palette is easy to get wrong). */
async function audit(page: Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(' | ')}`,
  );
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}

test('every voter screen has no WCAG 2.2 AA violations', async ({ page }, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);
  await page.goto('/vote');
  await expect(page.getByRole('button', { name: t.start })).toBeVisible();
  await page.waitForTimeout(600); // let the entrance animation finish: contrast is measured on settled pixels
  await audit(page, 'welcome');

  await page.getByRole('button', { name: t.start }).click();
  await expect(page.getByLabel(t.name)).toBeVisible();
  await page.waitForTimeout(600);
  await audit(page, 'details');

  await page.getByRole('button', { name: t.send }).click(); // trigger the validation state
  await expect(page.getByText(t.consentErr).first()).toBeVisible();
  await audit(page, 'details with errors');

  await signIn(page, locale);
  await page.waitForTimeout(600);
  await audit(page, 'hub');

  await page.getByText(t.choose).first().click();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await page.waitForTimeout(600);
  await audit(page, 'category');

  await page
    .locator('button')
    .filter({ has: page.locator('img, svg[viewBox="0 0 160 100"]') })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(600);
  await audit(page, 'confirm sheet');
});

test('system screens (gate, closed) have no WCAG 2.2 AA violations', async ({ page }, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);

  await pool.query(
    `UPDATE settings SET access_mode = 'IP_ALLOWLIST', venue_cidrs = '{203.0.113.0/24}'`,
  );
  await settle();
  await page.goto('/vote');
  await expect(page.getByRole('heading', { name: t.gate })).toBeVisible();
  await page.waitForTimeout(600);
  await audit(page, 'gate');

  await pool.query(`UPDATE settings SET access_mode = 'OFF', voting_status = 'CLOSED'`);
  await settle();
  await page.reload();
  await expect(page.getByRole('heading', { name: t.closed })).toBeVisible();
  await page.waitForTimeout(600);
  await audit(page, 'closed');
});

test('the confirm sheet traps focus and Escape closes it', async ({ page }, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await signIn(page, locale);
  await page.getByText(t.choose).first().click();
  await page
    .locator('button')
    .filter({ has: page.locator('img, svg[viewBox="0 0 160 100"]') })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    // A modal <dialog> makes the page behind it inert: focus is either inside the dialog or has left the page
    // for the browser's own UI (activeElement = body) — never on content underneath.
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return el === document.body ? 'browser' : el?.closest('dialog') ? 'dialog' : 'page';
    });
    expect(where, `Tab #${i + 1} must not reach the page behind the sheet`).not.toBe('page');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('the code and finish screens have no WCAG 2.2 AA violations', async ({ page }, info) => {
  const locale = localeOf(info);
  const t = T[locale];
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);
  await page.goto('/vote');
  await page.getByRole('button', { name: t.start }).click();
  await page.getByLabel(t.name).fill('Layla Haddad');
  await page.getByLabel(t.phone).fill(randomPhone());
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: t.send }).click();
  const input = page.getByLabel(t.code);
  await expect(input).toBeVisible();
  await page.waitForTimeout(600);
  await audit(page, 'code');

  await input.fill(await latestCode());
  await expect(page.getByRole('heading', { name: t.hub })).toBeVisible();
  const categories = await page.getByText(t.choose).count();
  for (let i = 0; i < categories; i++) {
    await voteInNextCategory(page, locale);
    if (i < categories - 1) await expect(page.getByRole('heading', { name: t.hub })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: t.thanks })).toBeVisible();
  await page.waitForTimeout(2200); // rays + trail finish animating
  await audit(page, 'finish');
});
