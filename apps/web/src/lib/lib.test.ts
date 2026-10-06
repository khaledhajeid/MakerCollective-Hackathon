import { describe, expect, it } from 'vitest';
import { ltr } from './bidi';
import { normaliseSearch, onColor } from './color';
import { formatNational, isJordanMobile, nationalDigits } from './phone';

describe('phone input', () => {
  it.each([
    ['0791234567', '791234567'],
    ['+962 79 123 4567', '791234567'],
    ['00962791234567', '791234567'],
    ['٠٧٩١٢٣٤٥٦٧', '791234567'], // Arabic-Indic digits from an Arabic keyboard
    ['79-123-4567', '791234567'],
    ['7912345678999', '791234567'], // capped at 9 digits
  ])('normalises %s', (input, expected) => expect(nationalDigits(input)).toBe(expected));

  it('formats progressively while typing', () => {
    expect(formatNational('7')).toBe('7');
    expect(formatNational('791')).toBe('79 1');
    expect(formatNational('791234567')).toBe('79 123 4567');
  });

  it('accepts Jordanian mobiles only (7[789]…)', () => {
    expect(isJordanMobile('791234567')).toBe(true);
    expect(isJordanMobile('771234567')).toBe(true);
    expect(isJordanMobile('781234567')).toBe(true);
    expect(isJordanMobile('761234567')).toBe(false);
    expect(isJordanMobile('79123456')).toBe(false);
    expect(isJordanMobile('0791234567')).toBe(false);
  });
});

describe('search normalisation', () => {
  it('ignores case, Arabic diacritics and spelling variants', () => {
    expect(normaliseSearch('AquaFog')).toBe('aquafog');
    expect(normaliseSearch('أكوا')).toBe(normaliseSearch('اكوا'));
    expect(normaliseSearch('مُهَنْدِس')).toBe(normaliseSearch('مهندس'));
    expect(normaliseSearch('مدرسة')).toBe(normaliseSearch('مدرسه'));
    expect(normaliseSearch('هوى')).toBe(normaliseSearch('هوي'));
  });
});

describe('onColor', () => {
  it('chooses a readable foreground for any admin-picked category colour', () => {
    expect(onColor('#f8d749')).toBe('#00007b'); // yellow → navy
    expect(onColor('#74dccf')).toBe('#00007b'); // turquoise → navy
    expect(onColor('#7f32d9')).toBe('#ffffff'); // purple → white
    expect(onColor('#00007b')).toBe('#ffffff');
    expect(onColor('not-a-colour')).toBe('#ffffff');
  });
});

describe('ltr isolate', () => {
  it('keeps a value together and unbreakable', () => {
    const out = ltr('+962 7•• ••• 567');
    expect(out).not.toContain(' ');
    expect(out.codePointAt(0)).toBe(0x2066);
    expect(out.at(-1)?.codePointAt(0)).toBe(0x2069);
  });
});
