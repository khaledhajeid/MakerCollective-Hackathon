import { toAsciiDigits } from '@mc/shared/digits';

/** National significant digits of a Jordanian mobile, from whatever the visitor typed or pasted (+962…, 00962…, 07…, ٠٧…). */
export function nationalDigits(input: string): string {
  let s = toAsciiDigits(input).replace(/\D/g, '');
  if (s.startsWith('00962')) s = s.slice(5);
  else if (s.startsWith('962')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  return s.slice(0, 9);
}

/** 79 123 4567 */
export function formatNational(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 9)].filter(Boolean).join(' ');
}

/** Jordan mobile: 7[789] + 7 digits. The server re-validates against the admin-managed prefix list. */
export const isJordanMobile = (digits: string): boolean => /^7[789]\d{7}$/.test(digits);
