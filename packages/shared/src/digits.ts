/**
 * Visitors on Arabic keyboards type Arabic-Indic (٠-٩) or Eastern Arabic-Indic (۰-۹) digits.
 * Normalise to ASCII before any parsing so `٠٧٩١٢٣٤٥٦٧` and `0791234567` are the same number.
 */
export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
