import { expect, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 4 });

export type Locale = 'ar' | 'en';
export const localeOf = (info: TestInfo): Locale => info.project.metadata.locale as Locale;

/** The strings the tests look for — also proves the copy is present in both languages. */
export const T = {
  ar: {
    start: 'ابدأ التصويت',
    name: 'الاسم',
    phone: 'رقم الجوال',
    send: 'أرسل الرمز',
    code: 'رمز التحقق',
    hub: 'اختر مفضّلك في كل فئة',
    choose: 'اضغط للاختيار',
    confirm: 'أؤكد تصويتي',
    recorded: 'تم تسجيل صوتك',
    thanks: /شكراً/,
    wrongCode: 'الرمز غير صحيح',
    waiting: 'لا يوجد اتصال. لم يُرسل صوتك بعد',
    closed: 'انتهى التصويت',
    gate: 'اتصل بشبكة الفعالية للتصويت',
    retry: 'اتصلت — تحقق مجدداً',
    consentErr: 'يرجى تحديد المربع الأول للمتابعة.',
    final: 'تم تسجيل صوتك في هذه الفئة.',
    review: 'مراجعة أصواتي',
    sessionEnded: 'انتهت جلستك. أدخل بياناتك للمتابعة.',
    yourVote: 'صوتك',
  },
  en: {
    start: 'Start voting',
    name: 'Your name',
    phone: 'Mobile number',
    send: 'Send code',
    code: 'Verification code',
    hub: 'Pick a favourite in every category',
    choose: 'Tap to choose',
    confirm: 'Confirm my vote',
    recorded: 'Vote recorded',
    thanks: /Thank you, /,
    wrongCode: "That code isn't right",
    waiting: 'No connection. Your vote has not been sent yet',
    closed: 'Voting has closed',
    gate: 'Join the event Wi-Fi to vote',
    retry: "I'm connected — check again",
    consentErr: 'Please tick the first box to continue.',
    final: 'Your vote in this category is recorded.',
    review: 'Review my votes',
    sessionEnded: 'Your session ended. Enter your details to continue.',
    yourVote: 'Your vote',
  },
} as const;

/** Settings are cached for 2 s inside the API; wait it out after changing them directly in the database. */
export const settle = () => new Promise((r) => setTimeout(r, 2300));

export async function resetDb(patch: Record<string, string> = {}): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL session_replication_role = replica'); // bypass the vote-final/audit triggers (test DB only)
    await c.query('TRUNCATE votes, otp_challenges, visitors, sms_outbox');
    await c.query(
      `UPDATE settings SET voting_status = 'OPEN', access_mode = 'OFF', venue_cidrs = '{}', wifi_ssid = 'MC2026'`,
    );
    for (const [col, val] of Object.entries(patch)) {
      if (!/^[a-z_]+$/.test(col)) throw new Error('bad column');
      await c.query(`UPDATE settings SET ${col} = $1`, [val]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function latestCode(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const { rows } = await pool.query<{ body: string }>(
      'SELECT body FROM sms_outbox ORDER BY created_at DESC LIMIT 1',
    );
    const m = /(\d{6})/.exec(rows[0]?.body ?? '');
    if (m) return m[1]!;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no SMS arrived in the demo outbox');
}

export const randomPhone = () => `79${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

/** Welcome → details → code → hub, through the real UI. */
export async function signIn(page: Page, locale: Locale, opts: { name?: string } = {}) {
  const t = T[locale];
  await page.addInitScript((l) => localStorage.setItem('mc_locale', l), locale);
  await page.goto('/vote');
  await page.getByRole('button', { name: t.start }).click();
  await page.getByLabel(t.name).fill(opts.name ?? 'Layla Haddad');
  await page.getByLabel(t.phone).fill(randomPhone());
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: t.send }).click();
  const input = page.getByLabel(t.code);
  await expect(input).toBeVisible();
  await input.fill(await latestCode());
  await expect(page.getByRole('heading', { name: t.hub })).toBeVisible();
}

/** Opens the first still-open category, picks its first exhibitor and confirms. */
export async function voteInNextCategory(page: Page, locale: Locale) {
  const t = T[locale];
  await page.getByText(t.choose).first().click();
  await page
    .locator('button')
    .filter({ has: page.locator('img, svg[viewBox="0 0 160 100"]') })
    .first()
    .click();
  await page.getByRole('dialog').getByRole('button', { name: t.confirm }).click();
  await expect(page.getByRole('heading', { name: t.recorded })).toBeVisible();
}
