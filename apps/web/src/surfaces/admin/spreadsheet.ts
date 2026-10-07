import { BULK_EXHIBITORS_MAX, ExhibitorCreateSchema } from '@mc/shared/manage';
import type { AdminCategory, ExhibitorCreate } from '@mc/shared/manage';

/*
 * Reading a spreadsheet of exhibitors. The organiser exports from Excel / Numbers / Google Sheets as CSV, the console
 * reads it here (nothing is uploaded until they press Import), and every row is checked with the SAME schema the
 * server uses, so what the preview calls "ready" is what the server accepts.
 */

const BOM = '﻿';

/** The delimiter Excel used: a comma, or a semicolon / tab in some regional settings. Judged on the header line. */
function delimiterOf(text: string): string {
  let best = ',';
  let most = -1;
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n += 1;
    }
    if (n > most) {
      most = n;
      best = d;
    }
  }
  return best;
}

/** RFC 4180: quoted cells may hold the delimiter, line breaks and doubled quotes. Blank lines are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRow();
    } else if (ch === '\n') endRow();
    else cell += ch;
  }
  endCell();
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** A CSV cell for the template download: quoted only when it has to be. */
const cellOut = (v: string) => (/[",\r\n;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** The columns, in the order of the template. `categories` holds category names separated by `;`. */
export const COLUMNS = [
  'name_en',
  'name_ar',
  'project_en',
  'project_ar',
  'description_en',
  'description_ar',
  'booth',
  'categories',
  'visible',
] as const;
type Column = (typeof COLUMNS)[number];

/** Header spellings that mean each column. Compared with everything but letters and digits removed. */
const ALIASES: Record<Column, string[]> = {
  name_en: ['nameen', 'name', 'exhibitor', 'team', 'nameenglish', 'englishname', 'exhibitorname'],
  name_ar: ['namear', 'namearabic', 'arabicname'],
  project_en: ['projecten', 'project', 'projectname', 'projecttitle', 'projectenglish'],
  project_ar: ['projectar', 'projectarabic'],
  description_en: ['descriptionen', 'description', 'descriptionenglish'],
  description_ar: ['descriptionar', 'descriptionarabic'],
  booth: ['booth', 'boothnumber', 'stand', 'table'],
  categories: ['categories', 'category'],
  visible: ['visible', 'active', 'isactive', 'show', 'shown', 'visibletovoters'],
};

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** A template the organiser can fill in: the header and one example row that uses a real category of theirs. */
export function templateCsv(categoryName: string | undefined): string {
  const example = [
    'Atlas Robotics',
    'أطلس للروبوتات',
    'Line-following robot',
    'روبوت يتبع الخط',
    'A small robot that follows a line and avoids obstacles.',
    'روبوت صغير يتبع الخط ويتجنب العوائق.',
    'B12',
    categoryName ?? 'Best Robot',
    'yes',
  ];
  return `${BOM}${COLUMNS.join(',')}\r\n${example.map(cellOut).join(',')}\r\n`;
}

export type RowState = 'ready' | 'error' | 'exists' | 'repeat';

export interface PreviewRow {
  /** The row's number in the spreadsheet (the header is row 1), so the organiser can find it. */
  line: number;
  nameEn: string;
  categories: string[];
  state: RowState;
  /** Why a row is not ready, in words an organiser can act on. */
  reason?: string;
  /** Present when `state` is `ready`. */
  value?: ExhibitorCreate;
}

export interface Preview {
  /** A problem with the file as a whole (no rows, no name column, too many rows). */
  fatal: string | null;
  rows: PreviewRow[];
  ready: ExhibitorCreate[];
}

const YES = new Set(['yes', 'y', 'true', '1', 'visible', 'show', 'نعم']);
const NO = new Set(['no', 'n', 'false', '0', 'hidden', 'hide', 'لا']);

/** Most rows one file may hold before it is refused outright (the server takes BULK_EXHIBITORS_MAX at a time). */
export const MAX_FILE_ROWS = 2000;

export function previewExhibitors(
  table: string[][],
  categories: readonly AdminCategory[],
  existingNames: readonly string[],
): Preview {
  const header = table[0];
  if (!header) return { fatal: 'The file is empty.', rows: [], ready: [] };

  const at = new Map<Column, number>();
  header.forEach((h, i) => {
    const key = squash(h);
    for (const col of COLUMNS) if (!at.has(col) && ALIASES[col].includes(key)) at.set(col, i);
  });
  if (!at.has('name_en'))
    return {
      fatal:
        'The first row must name the columns, and one of them must be "name_en" (the exhibitor\'s English name). Download the template to see the layout.',
      rows: [],
      ready: [],
    };
  const body = table.slice(1);
  if (body.length === 0)
    return { fatal: 'The file has a header but no exhibitors.', rows: [], ready: [] };
  if (body.length > MAX_FILE_ROWS)
    return {
      fatal: `The file has ${body.length} rows. Split it into files of at most ${MAX_FILE_ROWS}.`,
      rows: [],
      ready: [],
    };

  const cat = new Map<string, AdminCategory>();
  for (const c of categories)
    for (const key of [c.nameEn, c.nameAr, c.slug]) cat.set(key.trim().toLowerCase(), c);
  const known = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();

  const get = (r: string[], col: Column) => (at.has(col) ? (r[at.get(col)!] ?? '').trim() : '');

  const rows: PreviewRow[] = body.map((r, i) => {
    const line = i + 2;
    const nameEn = get(r, 'name_en');
    const wanted = get(r, 'categories')
      .split(/[;|\n،]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const base = { line, nameEn, categories: wanted };
    const fail = (reason: string): PreviewRow => ({ ...base, state: 'error', reason });

    if (!nameEn) return fail('The English name is empty.');
    const key = nameEn.toLowerCase();
    if (known.has(key))
      return { ...base, state: 'exists', reason: 'An exhibitor with this name already exists.' };
    if (seen.has(key))
      return { ...base, state: 'repeat', reason: 'This name appears earlier in the file.' };

    const categoryIds: string[] = [];
    for (const w of wanted) {
      const c = cat.get(w.toLowerCase());
      if (!c) return fail(`There is no category called "${w}".`);
      categoryIds.push(c.id);
    }

    let isActive = true;
    const visible = get(r, 'visible').toLowerCase();
    if (visible) {
      if (YES.has(visible)) isActive = true;
      else if (NO.has(visible)) isActive = false;
      else return fail('"visible" must be yes or no.');
    }

    const parsed = ExhibitorCreateSchema.safeParse({
      nameEn,
      nameAr: get(r, 'name_ar'),
      projectEn: get(r, 'project_en'),
      projectAr: get(r, 'project_ar'),
      descriptionEn: get(r, 'description_en'),
      descriptionAr: get(r, 'description_ar'),
      booth: get(r, 'booth'),
      categoryIds,
      isActive,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = String(issue?.path[0] ?? '');
      const label: Record<string, string> = {
        nameEn: 'English name',
        nameAr: 'Arabic name',
        projectEn: 'English project title',
        projectAr: 'Arabic project title',
        descriptionEn: 'English description',
        descriptionAr: 'Arabic description',
        booth: 'Booth',
      };
      const tooLong = issue?.code === 'too_big';
      return fail(
        `${label[field] ?? 'A value'} ${tooLong ? 'is too long.' : 'has a character that is not allowed.'}`,
      );
    }
    seen.add(key);
    return { ...base, state: 'ready', value: parsed.data };
  });

  const ready = rows.flatMap((r) => (r.value ? [r.value] : []));
  if (ready.length > BULK_EXHIBITORS_MAX)
    return {
      fatal: `${ready.length} exhibitors are ready, but ${BULK_EXHIBITORS_MAX} is the most to add at a time. Split the file.`,
      rows,
      ready: [],
    };
  return { fatal: null, rows, ready };
}

/**
 * The text of an uploaded file. Excel's "CSV UTF-8" is UTF-8; its plain "CSV" on an Arabic Windows is windows-1256,
 * which shows up as replacement characters when read as UTF-8, so that case is read again as windows-1256.
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1256').decode(bytes);
  } catch {
    return utf8;
  }
}

/** True for the first bytes of an .xlsx / .xls file, which this reader cannot open. */
export function looksLikeExcelFile(name: string, bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 4));
  const zip = head[0] === 0x50 && head[1] === 0x4b; // "PK": .xlsx is a zip
  const ole = head[0] === 0xd0 && head[1] === 0xcf; // old .xls
  return zip || ole || /\.xlsx?$/i.test(name);
}
