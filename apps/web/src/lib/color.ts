/** Readable foreground (navy or white) for an arbitrary admin-chosen category colour, by WCAG relative luminance. */
export function onColor(hex: string): '#00007b' | '#ffffff' {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.3 ? '#00007b' : '#ffffff';
}

/** Search normalisation: case, Arabic diacritics/tatweel, and the alef / ya / ta-marbuta spelling variants. */
export function normaliseSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}
