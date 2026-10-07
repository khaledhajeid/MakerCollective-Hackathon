import type { ResultExhibitor } from '@mc/shared';
import qrcode from 'qrcode-generator';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { MotifTile } from '../../design-system/Motifs';
import { ar, en } from '../../i18n/dict';

/** The TV always shows both languages at once, so it reads the dictionaries directly (no locale provider). */
export const A = ar.tv;
export const E = en.tv;
export type TvKey = keyof typeof A;
export const withTime = (text: string, time: string) => text.replace('{time}', time);

/**
 * An English line inside the right-to-left layout. Its own direction is LTR (so a long name truncates at its END,
 * not its start) while it still hangs from the same right edge as the Arabic line above it.
 */
export function En({
  children,
  className = '',
  centered = false,
}: {
  children: ReactNode;
  className?: string;
  /** Centre the line (cards) instead of hanging it from the right edge (rows). */
  centered?: boolean;
}) {
  return (
    <span
      lang="en"
      dir="ltr"
      className={`block ${centered ? 'text-center' : 'text-right'} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Arabic large, English beneath, aligned to the same edge. The English line has its own LTR direction, so names
 * with "&", digits or trailing punctuation never reorder inside the right-to-left line.
 */
export function Bi({
  k,
  time,
  arClass = 'text-[56px] font-bold leading-[1.25]',
  enClass = 'text-[40px] font-normal leading-[1.1] text-white/72',
  className = '',
}: {
  k: TvKey;
  time?: string;
  arClass?: string;
  enClass?: string;
  className?: string;
}) {
  const a = time ? withTime(A[k], time) : A[k];
  const e = time ? withTime(E[k], time) : E[k];
  return (
    <span className={`block ${className}`}>
      <span lang="ar" className={`block ${arClass}`}>
        {a}
      </span>
      <En className={enClass}>{e}</En>
    </span>
  );
}

/**
 * `truncate` clips at the line box, which slices Arabic descenders (غ ج ق) and Latin g/y/p. Padding grows the clip
 * box and an equal negative margin gives the space back, so layout is unchanged but nothing is cut.
 */
const CLIP = 'truncate py-[0.22em] -my-[0.22em]';

/** Name pair for an exhibitor or category: Arabic first (when it exists), English beneath. */
export function Names({
  nameAr,
  nameEn,
  arClass,
  enClass,
  className = '',
  centered = false,
}: {
  nameAr: string | null;
  nameEn: string;
  arClass: string;
  enClass: string;
  className?: string;
  centered?: boolean;
}) {
  if (!nameAr) {
    return (
      <En centered={centered} className={`${CLIP} ${arClass} ${className}`}>
        {nameEn}
      </En>
    );
  }
  return (
    <span className={`block min-w-0 ${className}`}>
      <span lang="ar" className={`block ${centered ? 'text-center' : ''} ${CLIP} ${arClass}`}>
        {nameAr}
      </span>
      <En centered={centered} className={`${CLIP} ${enClass}`}>
        {nameEn}
      </En>
    </span>
  );
}

/** The brand chevron in a category's colour; points along the reading direction (right-to-left here). */
export function Chevron({
  color,
  size = 36,
  className = '',
}: {
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 44.6 51.4"
      width={size}
      height={(size * 51.4) / 44.6}
      className={`shrink-0 -scale-x-100 ${className}`}
      aria-hidden="true"
    >
      <path
        d="M44.6 25.7 0 0v51.4Z"
        fill={color}
        stroke="rgb(255 255 255 / 0.7)"
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  );
}

/** The brand's dotted gear ring, large and slow: the "sealed" and "waiting" motif. */
export function SlowGear({ size, className = '' }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`overflow-visible ${className}`}
      aria-hidden="true"
    >
      <g className="tv-turn">
        <circle
          cx="12"
          cy="12"
          r="10.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="1.35 1.05"
        />
      </g>
      <g className="tv-turn-rev">
        <circle
          cx="12"
          cy="12"
          r="7.1"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.1"
          strokeDasharray="0.9 1.1"
        />
      </g>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}

/** Exhibitor photo, or the deterministic brand tile when there is none (or it fails to load). */
export function Photo({
  ex,
  size,
  radius = 22,
  className = '',
  ring = 'ring-2 ring-white/25',
}: {
  ex: Pick<ResultExhibitor, 'id' | 'nameEn' | 'nameAr' | 'photoUrl'>;
  size: number;
  radius?: number;
  className?: string;
  /** Tailwind ring classes: keeps a tile of any colour readable on any row colour. */
  ring?: string;
}) {
  // Remember WHICH url failed: a corrected photo on a later frame must get its chance (same component instance).
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const broken = brokenUrl !== null && brokenUrl === ex.photoUrl;
  const style: CSSProperties = { width: size, height: size, borderRadius: radius };
  return (
    <span className={`block shrink-0 overflow-hidden ${ring} ${className}`} style={style}>
      {ex.photoUrl && !broken ? (
        <img
          src={ex.photoUrl}
          alt=""
          width={size}
          height={size}
          decoding="async"
          onError={() => setBrokenUrl(ex.photoUrl)}
          className="size-full object-cover"
        />
      ) : (
        // The brand tile is drawn for a 160px card: render it there and scale it down, so its motifs and
        // initial keep their proportions at any TV size.
        <span dir="ltr" className="block size-full overflow-hidden">
          <span
            className="block origin-top-left"
            style={{ width: 160, height: 160, transform: `scale(${size / 160})` }}
          >
            <MotifTile seed={ex.id} label={ex.nameAr ?? ex.nameEn} className="size-full" noYellow />
          </span>
        </span>
      )}
    </span>
  );
}

/** A static QR for the public voting URL: it carries nothing private, so it is safe on any screen. */
export function QrCode({
  text,
  size,
  className = '',
}: {
  text: string;
  size: number;
  className?: string;
}) {
  const { path, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { path: d, n: count };
  }, [text]);
  return (
    <svg
      viewBox={`-4 -4 ${n + 8} ${n + 8}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={A.scanToVote}
      className={`shrink-0 rounded-[14px] bg-white ${className}`}
    >
      <path d={path} fill="#00004a" />
    </svg>
  );
}

/** Where the QR points: this very site's voter app. */
export const voteUrl = () => `${window.location.origin}/vote`;
