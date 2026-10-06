/** Unicode bidi helpers, built from code points so editors/formatters can never turn them into invisible literals. */
const LRI = String.fromCharCode(0x2066); // left-to-right isolate
const PDI = String.fromCharCode(0x2069); // pop directional isolate
const NBSP = String.fromCharCode(0x00a0);

/** Keep a number/phone/time as one left-to-right unit inside right-to-left (or any) text, and unbreakable. */
export const ltr = (text: string): string => LRI + text.replaceAll(' ', NBSP) + PDI;
