import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, PHOTO_MIN_SIDE } from '@mc/shared/manage';
import { AppError } from '../../lib/errors.js';

export interface WebpInfo {
  width: number;
  height: number;
}

const reject = (why: string): never => {
  throw new AppError(400, 'VALIDATION_FAILED', `The photo was refused: ${why}`);
};

const FLAG_ALPHA = 0x10;
const FLAG_ICC = 0x20;
// Animation, XMP and EXIF: refused. A photo carries pixels and nothing else.
const FLAGS_REFUSED = 0x02 | 0x04 | 0x08;
/**
 * The one extra a browser always adds: a small colour profile (Chrome writes its 456-byte sRGB profile into every WebP a
 * canvas exports). It describes colours, not the person or the place, so it is allowed, but only in its place (right
 * after the header, before any alpha data), only when the header says so, and only if it is small.
 */
const ICC_MAX_BYTES = 8 * 1024;

/**
 * Parses a WebP file the way a decoder would find its structure, and refuses anything that is not a plain still
 * image. The console already crops and re-encodes in the browser (which drops EXIF/GPS), but the server never trusts
 * the browser: the upload must be exactly a RIFF/WebP container whose chunks are image data only, whose declared
 * sizes add up to the file length (no trailing bytes, nothing hidden after the image), and whose real pixel
 * dimensions are inside the allowed range. Unknown chunks (EXIF, XMP, ICCP, ANIM…) are refused, not skipped.
 */
export function inspectWebp(buf: Buffer): WebpInfo {
  if (buf.length < 30) return reject('too small to be an image');
  if (buf.length > PHOTO_MAX_BYTES) return reject('too large (350 KB at most)');
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP')
    return reject('not a WebP image');
  if (buf.readUInt32LE(4) !== buf.length - 8) return reject('the file is damaged');

  let off = 12;
  let canvas: WebpInfo | null = null;
  let image: WebpInfo | null = null;
  let alphChunka = false;
  let iccAllowed = false;
  let sawIcc = false;
  let alphChunk = false;

  while (off < buf.length) {
    if (off + 8 > buf.length) return reject('the file is damaged');
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    const end = start + size;
    if (end > buf.length) return reject('the file is damaged');

    switch (id) {
      case 'VP8X': {
        if (off !== 12 || size !== 10) return reject('the file is damaged');
        const flags = buf[start]!;
        if (flags & FLAGS_REFUSED) return reject('animation and metadata are not allowed');
        canvas = {
          width: 1 + buf.readUIntLE(start + 4, 3),
          height: 1 + buf.readUIntLE(start + 7, 3),
        };
        alphChunka = !!(flags & FLAG_ALPHA);
        iccAllowed = !!(flags & FLAG_ICC);
        break;
      }
      case 'ICCP':
        if (!canvas || !iccAllowed || sawIcc || alphChunk || image || size > ICC_MAX_BYTES)
          return reject('animation and metadata are not allowed');
        sawIcc = true;
        break;
      case 'ALPH':
        if (!canvas || !alphChunka || alphChunk || image) return reject('the file is damaged');
        alphChunk = true;
        break;
      case 'VP8 ': {
        if (image || size < 10) return reject('the file is damaged');
        const keyframe = (buf[start]! & 1) === 0;
        if (
          !keyframe ||
          buf[start + 3] !== 0x9d ||
          buf[start + 4] !== 0x01 ||
          buf[start + 5] !== 0x2a
        )
          return reject('the file is damaged');
        image = {
          width: buf.readUInt16LE(start + 6) & 0x3fff,
          height: buf.readUInt16LE(start + 8) & 0x3fff,
        };
        break;
      }
      case 'VP8L': {
        if (image || size < 5 || buf[start] !== 0x2f) return reject('the file is damaged');
        const bits = buf.readUInt32LE(start + 1);
        image = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        break;
      }
      default:
        return reject('animation and metadata are not allowed');
    }
    off = end + (size & 1);
  }

  if (off !== buf.length || !image) return reject('the file is damaged');
  // A header that promises a colour profile must deliver it, in its place: the layout is exactly what we documented.
  if (iccAllowed && !sawIcc) return reject('the file is damaged');
  if (canvas && (canvas.width !== image.width || canvas.height !== image.height))
    return reject('the file is damaged');
  const { width, height } = image;
  if (
    width < PHOTO_MIN_SIDE ||
    height < PHOTO_MIN_SIDE ||
    width > PHOTO_MAX_SIDE ||
    height > PHOTO_MAX_SIDE
  )
    return reject(`dimensions must be between ${PHOTO_MIN_SIDE} and ${PHOTO_MAX_SIDE} pixels`);
  return { width, height };
}
