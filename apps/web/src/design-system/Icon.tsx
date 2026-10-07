import type { SVGProps } from 'react';

/** One hand-drawn set, one stroke style (2px, round caps). No icon library — about 1 KB for all of them. */
const PATHS = {
  check: 'M5 12.5 9.5 17 19 7.5',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1',
  forward: 'm9 5 7 7-7 7',
  back: 'm15 5-7 7 7 7',
  close: 'm6 6 12 12M18 6 6 18',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm9 15.5-4.2-4.2',
  wifi: 'M2.5 9.2a14 14 0 0 1 19 0M5.7 12.6a9.4 9.4 0 0 1 12.6 0M8.9 16a4.8 4.8 0 0 1 6.2 0M12 19.4h.01',
  alert:
    'M12 8.5v4.5m0 3.5h.01M10.3 4.2 2.7 17.4A2 2 0 0 0 4.4 20.4h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
  info: 'M12 11v5.5m0-9h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5',
  shield: 'M12 3 5 6v5.5c0 4.2 2.8 7.5 7 9.5 4.2-2 7-5.3 7-9.5V6l-7-3Z',
  signal: 'M3 3l18 18M8.5 8.8A8 8 0 0 0 5 12.2M16 12.2a8 8 0 0 0-2-1.9M12 18.5h.01',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Mirror in right-to-left layouts (arrows and chevrons point along the reading direction). */
  flip?: boolean;
}

export function Icon({ name, size = 22, flip, className = '', ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${flip ? 'rtl:-scale-x-100' : ''} ${className}`}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
