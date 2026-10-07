/**
 * CSV for spreadsheets, safe to open (OWASP "CSV injection"). A cell that starts with = + - @ tab or CR is executed as a
 * formula by Excel / Sheets / LibreOffice, and names and project titles are typed by strangers, so such cells get a
 * leading apostrophe (shown as plain text, not evaluated). Two shapes are left alone because they cannot call
 * anything: a strict international phone number (`+9627…`) and a plain number.
 * Output is UTF-8 with a byte-order mark (Excel then reads Arabic correctly) and CRLF line ends (RFC 4180).
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_PHONE = /^\+\d{7,15}$/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export type Cell = string | number | boolean | null | undefined;

export function csvCell(value: Cell): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(s) && !PLAIN_PHONE.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `\uFEFF${body}\r\n`;
}
