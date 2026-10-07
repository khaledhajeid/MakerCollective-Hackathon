import type { CSSProperties } from 'react';

/**
 * Brand pattern vocabulary (guidelines p.10): gear = Innovation, circle = Community, triangle =
 * Entrepreneurship, spiral + rays = Empowerment, chevron trail = the cover mark.
 */

/** The brand's right-pointing chevron triangle, path taken from the logo artwork. */
const CHEVRON = 'M44.6 25.7 0 0v51.4Z';
export const BRAND_TRAIL = ['#00007b', '#4a68d8', '#74dccf', '#7f32d9', '#f8d749'] as const;

/** One triangle per category: lit in brand order when voted, outlined while pending. Points along the reading direction. */
export function ChevronTrail({
  total,
  filled,
  onDark = false,
  stagger = 0,
  className = '',
}: {
  total: number;
  filled: number;
  onDark?: boolean;
  /** ms between each triangle lighting up (used for the finish moment). */
  stagger?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 rtl:-scale-x-100 ${className}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const on = i < filled;
        const fill = onDark && i === 0 ? '#ffffff' : BRAND_TRAIL[i % BRAND_TRAIL.length];
        return (
          <svg
            key={i}
            viewBox="0 0 44.6 51.4"
            className="h-5 w-[1.2rem] transition-[transform,opacity] duration-500 ease-out"
            style={{
              transform: on ? 'scale(1.12)' : 'scale(1)',
              transitionDelay: `${i * stagger}ms`,
            }}
          >
            <path
              d={CHEVRON}
              className="transition-[fill,stroke] duration-500"
              style={{ transitionDelay: `${i * stagger}ms` }}
              fill={on ? fill : 'transparent'}
              stroke={on ? fill : onDark ? 'rgb(255 255 255 / 0.45)' : '#b9b9d6'}
              strokeWidth={4}
              strokeLinejoin="round"
            />
          </svg>
        );
      })}
    </div>
  );
}

/** The dotted gear ring — the brand's loading mark. */
export function Gear({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      style={{ animationDuration: '1.6s' }}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="8.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.6"
        strokeDasharray="2.6 2.1"
      />
    </svg>
  );
}

/** Concentric "spiral" rings from the Empowerment motif, for hero backgrounds. */
export function Rings({
  className = '',
  style,
  stroke = 'rgb(255 255 255 / 0.16)',
}: {
  className?: string;
  style?: CSSProperties;
  stroke?: string;
}) {
  return (
    <svg
      viewBox="0 0 400 400"
      className={`overflow-visible ${className}`}
      style={style}
      aria-hidden="true"
      fill="none"
    >
      {Array.from({ length: 13 }, (_, i) => (
        <circle
          key={i}
          cx={200 + i * 1.4}
          cy={200 - i * 1.1}
          r={22 + i * 15.5}
          stroke={stroke}
          strokeWidth={1.4}
        />
      ))}
    </svg>
  );
}

/** Light rays for the success moment; each ray is a thin rounded line that scales out from the centre. */
export function Rays({ count = 12, className = '' }: { count?: number; className?: string }) {
  const colors = ['#f8d749', '#74dccf', '#ffffff', '#4a68d8'];
  return (
    <svg viewBox="-100 -100 200 200" className={className} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        const r1 = i % 2 ? 54 : 50;
        const r2 = i % 2 ? 78 : 90;
        return (
          <line
            key={i}
            x1={Math.cos(a) * r1}
            y1={Math.sin(a) * r1}
            x2={Math.cos(a) * r2}
            y2={Math.sin(a) * r2}
            stroke={colors[i % colors.length]}
            strokeWidth={4.5}
            strokeLinecap="round"
            className="ray"
            style={{ ['--i' as string]: i }}
          />
        );
      })}
    </svg>
  );
}

/* ───────────── Exhibitor "no photo" tile ───────────── */

const TONES = [
  { bg: '#00007b', fg: '#ffffff', a: '#74dccf', b: '#f8d749' },
  { bg: '#7f32d9', fg: '#ffffff', a: '#f8d749', b: '#74dccf' },
  { bg: '#4a68d8', fg: '#ffffff', a: '#74dccf', b: '#f8d749' },
  { bg: '#74dccf', fg: '#00007b', a: '#00007b', b: '#ffffff' },
  { bg: '#f8d749', fg: '#00007b', a: '#7f32d9', b: '#ffffff' },
] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Deterministic brand-pattern tile for exhibitors without a photo: the same project always gets the same
 * tile, and it reads as a designed placeholder rather than a missing image.
 */
export function MotifTile({
  seed,
  label,
  className = '',
  noYellow = false,
}: {
  seed: string;
  label: string;
  className?: string;
  /** Skip the yellow-ground tile (a surface that reserves yellow for something else, e.g. the TV leader row). */
  noYellow?: boolean;
}) {
  const h = hash(seed);
  const pool = noYellow ? TONES.filter((t) => t.bg !== '#f8d749') : TONES;
  const tone = pool[h % pool.length]!;
  const layout = (h >>> 5) % 3;
  const initial = [...label.trim()][0] ?? '·';
  // Rings (the brand's spiral motif) quietly fill the tile; one confident accent shape carries the identity.
  const ringCentre = layout === 0 ? [0, 100] : layout === 1 ? [160, 0] : [150, 100];
  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      style={{ background: tone.bg, color: tone.fg }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 160 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <g fill="none" stroke={tone.fg} strokeOpacity="0.16" strokeWidth="1.2">
          {Array.from({ length: 9 }, (_, i) => (
            <circle
              key={i}
              cx={ringCentre[0]! + i * 0.8}
              cy={ringCentre[1]! - i * 0.6}
              r={14 + i * 13}
            />
          ))}
        </g>
        {layout === 0 && (
          <>
            <circle cx="126" cy="30" r="15" fill={tone.a} />
            <path d="M104 62 124 74 104 86Z" fill={tone.b} />
          </>
        )}
        {layout === 1 && (
          <>
            <path d="M24 22 50 37 24 52Z" fill={tone.a} />
            <circle
              cx="62"
              cy="26"
              r="7"
              fill="none"
              stroke={tone.b}
              strokeWidth="3.4"
              strokeDasharray="3.6 2.8"
            />
          </>
        )}
        {layout === 2 && (
          <g>
            <path d="M18 14 34 23 18 32Z" fill={tone.a} />
            <path d="M40 14 56 23 40 32Z" fill={tone.b} />
            <circle cx="126" cy="72" r="13" fill={tone.a} opacity="0.95" />
          </g>
        )}
      </svg>
      <span
        className="absolute bottom-2.5 start-4 text-[3.25rem] font-black leading-none"
        style={{ color: tone.fg, fontFamily: 'var(--font-sans)' }}
      >
        {initial}
      </span>
    </div>
  );
}
