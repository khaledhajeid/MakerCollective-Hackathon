import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard. The TV chunk is imported lazily, and in the production build the stylesheet it imported was
 * never linked to the page (the dev server and the browser tests hid this): no ground, no motion, no Blind Hour
 * freeze, no reveal blur. The TV styles must come from the entry point, which always loads them.
 */
describe('TV styles', () => {
  it('are imported by the entry point, not only by the lazy TV chunk', () => {
    const main = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
    expect(main).toMatch(/import ['"]\.\/surfaces\/live\/live\.css['"]/);
    const mount = readFileSync(new URL('./mount.tsx', import.meta.url), 'utf8');
    expect(mount).not.toMatch(/live\.css/);
  });
});
