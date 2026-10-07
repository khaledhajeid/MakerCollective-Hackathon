import type { ResultExhibitor } from '@mc/shared';
import qrcode from 'qrcode-generator';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { MotifTile } from '../../design-system/Motifs';
import { ar, en } from '../../i18n/dict';
import type { NameFit } from './layout';

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
  style,
}: {
  children: ReactNode;
  className?: string;
  /** Centre the line (cards) instead of hanging it from the right edge (rows). */
  centered?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      lang="en"
      dir="ltr"
      className={`block ${centered ? 'text-center' : 'text-right'} ${className}`}
      style={style}
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
  enClass = 'text-[40px] font-normal leading-[1.1] text-dim',
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
 * Arabic name large, English beneath, both in full: they wrap onto further lines and the size comes from `fit`
 * (layout.ts), never from clipping. `overflow-wrap: anywhere` is the last resort for one enormous word.
 * A name with no Arabic shows its English line at the large size.
 */
export function FitNames({
  nameAr,
  nameEn,
  fit,
  arClass = 'font-bold',
  enClass = 'text-dim',
  className = '',
  centered = false,
}: {
  nameAr: string | null;
  nameEn: string;
  fit: Pick<NameFit, 'ar' | 'en'>;
  arClass?: string;
  enClass?: string;
  className?: string;
  centered?: boolean;
}) {
  const align = centered ? 'text-center' : '';
  const wrap = '[overflow-wrap:anywhere]';
  if (!nameAr) {
    return (
      <En
        centered={centered}
        className={`${wrap} font-bold ${arClass} ${className}`}
        style={{ fontSize: fit.ar, lineHeight: 1.2 }}
      >
        {nameEn}
      </En>
    );
  }
  return (
    <span className={`block min-w-0 ${className}`}>
      <span
        lang="ar"
        className={`block ${align} ${wrap} ${arClass}`}
        style={{ fontSize: fit.ar, lineHeight: 1.32 }}
      >
        {nameAr}
      </span>
      <En
        centered={centered}
        className={`${wrap} ${enClass}`}
        style={{ fontSize: fit.en, lineHeight: 1.2 }}
      >
        {nameEn}
      </En>
    </span>
  );
}

/** The brand chevron; points along the reading direction (right-to-left here). */
export function Chevron({
  color,
  size = 36,
  className = '',
  edge = 'rgb(255 255 255 / 0.7)',
}: {
  color: string;
  size?: number;
  className?: string;
  /** Outline that keeps a dark or pale category colour visible on any ground. */
  edge?: string;
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
        stroke={edge}
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
      <path d={path} className="fill-navy-deep" />
    </svg>
  );
}

/** Where the QR points: this very site's voter app. */
export const voteUrl = () => `${window.location.origin}/vote`;

/**
 * The place, as a medal: gold, silver, bronze, each with a navy numeral. The block a place sits on keeps the ladder
 * (yellow, light glass, dark glass); the medal is what names the place. Gold is a deeper metal than the brand yellow,
 * so it stays readable on the yellow first-place block (where the medal also carries a navy ring).
 */
export const PLACE_STYLE = {
  1: { fill: '#e0a526', ink: 'var(--color-navy)' },
  2: { fill: '#c8cdd6', ink: 'var(--color-navy)' },
  3: { fill: '#c97a3a', ink: 'var(--color-navy)' },
} as const;
export const placeOf = (rank: number): 1 | 2 | 3 => (rank <= 1 ? 1 : rank === 2 ? 2 : 3);

export function PlaceBadge({
  rank,
  size = 68,
  className = '',
}: {
  rank: number;
  size?: number;
  /** Tailwind ring classes, e.g. a navy ring when the medal sits on a yellow block. */
  className?: string;
}) {
  const p = placeOf(rank);
  const { fill, ink } = PLACE_STYLE[p];
  return (
    <span
      role="img"
      aria-label={`${p}`}
      data-place={p}
      className={`num inline-flex shrink-0 items-center justify-center rounded-full font-black leading-none ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.56, background: fill, color: ink }}
    >
      <span aria-hidden="true">{p}</span>
    </span>
  );
}

/** "votes / صوت" in the small unit size, so a number on the board is always read as a count. */
export function VotesUnit({
  className = '',
  large = false,
}: {
  className?: string;
  large?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-[8px] whitespace-nowrap leading-none ${className}`}
    >
      <span lang="ar" className={`${large ? 'text-[34px]' : 'text-[28px]'} font-bold`}>
        {A.votes}
      </span>
      <bdi lang="en" className={large ? 'text-[30px]' : 'text-[26px]'}>
        {E.votes}
      </bdi>
    </span>
  );
}
