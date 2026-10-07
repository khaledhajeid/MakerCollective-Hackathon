import { describe, expect, it } from 'vitest';
import type { AdminCategory } from '@mc/shared/manage';
import {
  COLUMNS,
  decodeCsv,
  looksLikeExcelFile,
  parseCsv,
  previewExhibitors,
  templateCsv,
} from './spreadsheet';

const cat = (id: string, nameEn: string, nameAr: string, slug: string): AdminCategory => ({
  id,
  slug,
  nameEn,
  nameAr,
  descriptionEn: null,
  descriptionAr: null,
  color: '#00007b',
  sortOrder: 0,
  isActive: true,
  exhibitorCount: 0,
  hasVotes: false,
});
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const cats = [
  cat(A, 'Best Robot', 'أفضل روبوت', 'best-robot'),
  cat(B, 'Best App', 'أفضل تطبيق', 'best-app'),
];

describe('parseCsv', () => {
  it('reads quoted cells with commas, quotes and line breaks, and drops blank lines', () => {
    const t = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n,,\r\n');
    expect(t).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
    ]);
  });
  it('strips the byte-order mark and copes with a last line without a line break', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('detects semicolon and tab files (Excel in some regions)', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('round-trips the template', () => {
    const t = parseCsv(templateCsv('Best Robot'));
    expect(t[0]).toEqual([...COLUMNS]);
    expect(t[1]![0]).toBe('Atlas Robotics');
    expect(t[1]![7]).toBe('Best Robot');
  });
});

describe('previewExhibitors', () => {
  const head = 'name_en,name_ar,booth,categories,visible';
  const preview = (rows: string[], existing: string[] = []) =>
    previewExhibitors(parseCsv([head, ...rows].join('\n')), cats, existing);

  it('turns good rows into what the server accepts, matching categories by English, Arabic or slug', () => {
    const p = preview([
      'Atlas,أطلس,B1,Best Robot; best-app,yes',
      'Zeta,,,أفضل تطبيق,no',
      'Loose,,,,',
    ]);
    expect(p.fatal).toBeNull();
    expect(p.rows.map((r) => r.state)).toEqual(['ready', 'ready', 'ready']);
    expect(p.ready[0]).toMatchObject({
      nameEn: 'Atlas',
      nameAr: 'أطلس',
      booth: 'B1',
      categoryIds: [A, B],
      isActive: true,
    });
    expect(p.ready[1]).toMatchObject({ categoryIds: [B], isActive: false });
    expect(p.ready[2]).toMatchObject({ categoryIds: [], isActive: true });
  });

  it('numbers rows like the spreadsheet (header is row 1) and says what is wrong', () => {
    const p = preview([',x,,Best Robot,', 'A,,,Nope,', 'B,,,,maybe', `C,,${'z'.repeat(25)},,`]);
    expect(p.rows.map((r) => [r.line, r.state])).toEqual([
      [2, 'error'],
      [3, 'error'],
      [4, 'error'],
      [5, 'error'],
    ]);
    expect(p.rows[0]!.reason).toMatch(/English name is empty/);
    expect(p.rows[1]!.reason).toBe('There is no category called "Nope".');
    expect(p.rows[2]!.reason).toMatch(/yes or no/);
    expect(p.rows[3]!.reason).toBe('Booth is too long.');
    expect(p.ready).toHaveLength(0);
  });

  it('skips names that already exist or repeat inside the file, ignoring case', () => {
    const p = preview(['atlas,,,,', 'New,,,,', 'new ,,,,'], ['Atlas']);
    expect(p.rows.map((r) => r.state)).toEqual(['exists', 'ready', 'repeat']);
    expect(p.ready.map((r) => r.nameEn)).toEqual(['New']);
  });

  it('accepts common header spellings and any column order', () => {
    const p = previewExhibitors(
      parseCsv('Category,Booth,Name,Description\nBest App,C3,Nova,Hello'),
      cats,
      [],
    );
    expect(p.ready[0]).toMatchObject({
      nameEn: 'Nova',
      booth: 'C3',
      descriptionEn: 'Hello',
      categoryIds: [B],
    });
  });

  it('refuses a file without a name column, or without rows, or with too many', () => {
    expect(previewExhibitors(parseCsv('title,booth\nA,B'), cats, []).fatal).toMatch(/name_en/);
    expect(previewExhibitors(parseCsv('name_en,booth'), cats, []).fatal).toMatch(/no exhibitors/);
    expect(previewExhibitors([], cats, []).fatal).toMatch(/empty/);
    const many = ['name_en', ...Array.from({ length: 301 }, (_, i) => `Team ${i}`)].join('\n');
    expect(previewExhibitors(parseCsv(many), cats, []).fatal).toMatch(/300/);
  });

  it('keeps Arabic text intact', () => {
    const p = previewExhibitors(
      parseCsv('name_en,name_ar,description_ar\nA,"مشروع، ذكي","وصف\nطويل"'),
      cats,
      [],
    );
    expect(p.ready[0]).toMatchObject({ nameAr: 'مشروع، ذكي', descriptionAr: 'وصف\nطويل' });
  });
});

describe('reading the file itself', () => {
  it('reads UTF-8, and falls back to windows-1256 when Excel saved plain "CSV" on Arabic Windows', () => {
    const utf8 = new TextEncoder().encode('name_en,name_ar\nA,أطلس').buffer as ArrayBuffer;
    expect(decodeCsv(utf8)).toContain('أطلس');
    // "أطلس" in windows-1256
    const win = new Uint8Array([
      ...new TextEncoder().encode('name_en,name_ar\nA,'),
      0xc3,
      0xd8,
      0xe1,
      0xd3,
    ]);
    expect(decodeCsv(win.buffer as ArrayBuffer)).toContain('أطلس');
  });
  it('recognises Excel workbooks, which it cannot open', () => {
    expect(
      looksLikeExcelFile('a.xlsx', new Uint8Array([0x50, 0x4b, 3, 4]).buffer as ArrayBuffer),
    ).toBe(true);
    expect(looksLikeExcelFile('a.xls', new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer)).toBe(
      true,
    );
    expect(
      looksLikeExcelFile('a.csv', new TextEncoder().encode('name_en').buffer as ArrayBuffer),
    ).toBe(false);
  });
});
