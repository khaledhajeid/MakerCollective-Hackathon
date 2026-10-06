import { describe, expect, it } from 'vitest';
import { ar, en } from './dict';

/** Collects every leaf path so a missing or extra key in either language is a test failure, not a blank label. */
const leaves = (o: unknown, prefix = ''): string[] =>
  typeof o === 'string'
    ? [prefix]
    : Array.isArray(o)
      ? o.flatMap((v, i) => leaves(v, `${prefix}[${i}]`))
      : Object.entries(o as object).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const get = (o: unknown, path: string): unknown =>
  path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], o);

describe('AR / EN dictionaries', () => {
  it('have exactly the same keys (plural forms may differ per language)', () => {
    const strip = (p: string) => p.replace(/\.(zero|one|two|few|many|other)$/, '');
    expect(new Set(leaves(ar).map(strip))).toEqual(new Set(leaves(en).map(strip)));
  });

  it('use the same {placeholders} in both languages', () => {
    for (const path of leaves(en)) {
      const enText = get(en, path);
      const arText = get(ar, path);
      if (typeof arText !== 'string') continue; // plural groups are checked below
      expect(placeholders(arText), path).toEqual(placeholders(enText as string));
    }
  });

  it('Arabic provides every CLDR plural form it needs for project counts', () => {
    const forms = Object.keys(ar.category.count);
    for (const f of ['zero', 'one', 'two', 'few', 'many', 'other']) expect(forms).toContain(f);
    const rules = new Intl.PluralRules('ar');
    for (const n of [0, 1, 2, 3, 10, 11, 99, 100]) {
      expect(
        ar.category.count[rules.select(n) as keyof typeof ar.category.count] ??
          ar.category.count.other,
      ).toBeTruthy();
    }
  });

  it('has no empty copy', () => {
    for (const d of [ar, en])
      for (const p of leaves(d)) expect((get(d, p) as string).trim(), p).not.toBe('');
  });
});
