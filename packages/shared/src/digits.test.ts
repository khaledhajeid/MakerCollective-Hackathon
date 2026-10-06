import { describe, expect, it } from 'vitest';
import { toAsciiDigits } from './digits.js';

describe('toAsciiDigits', () => {
  it('converts Arabic-Indic and Eastern Arabic-Indic digits', () => {
    expect(toAsciiDigits('٠٧٩١٢٣٤٥٦٧')).toBe('0791234567');
    expect(toAsciiDigits('۰۷۹۱۲۳۴۵۶۷')).toBe('0791234567');
  });
  it('leaves ASCII and other characters untouched', () => {
    expect(toAsciiDigits('+962 79-123')).toBe('+962 79-123');
  });
});
