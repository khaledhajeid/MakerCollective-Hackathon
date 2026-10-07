import type { SVGProps } from 'react';

/** The console's own icon set: same 2 px round-cap drawing style as the voter app, kept out of the voter bundle. */
const PATHS = {
  overview: 'M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-3H4v3Z',
  content: 'm12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  settings: 'M4 7h9m4 0h3M4 17h3m4 0h9M15 4v6M9 14v6',
  tv: 'M3 6h18v11H3V6Zm5 15h8m-4-4v4',
  users:
    'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19m6-8a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm10 8v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.8a3.2 3.2 0 0 1 0 6.1',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14',
  upload: 'M12 16V5m0 0 4 4m-4-4-4 4M5 20h14',
  log: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4m-4-4h11',
  menu: 'M4 7h16M4 12h16M4 17h16',
  inbox: 'M3 12h5l1.5 3h5L16 12h5M5.5 5h13l2.5 7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6l2.5-7Z',
  key: 'M14.5 9.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 12l8 8m-3-3 2-2',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  copy: 'M9 9h11v11H9V9Zm-4 6V4h11',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 18.4 18.4 5.6',
  check: 'M5 12.5 9.5 17 19 7.5',
  close: 'm6 6 12 12M18 6 6 18',
  alert:
    'M12 8.5v4.5m0 3.5h.01M10.3 4.2 2.7 17.4A2 2 0 0 0 4.4 20.4h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
  info: 'M12 11v5.5m0-9h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm9 15.5-4.2-4.2',
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5',
  wifi: 'M2.5 9.2a14 14 0 0 1 19 0M5.7 12.6a9.4 9.4 0 0 1 12.6 0M8.9 16a4.8 4.8 0 0 1 6.2 0M12 19.4h.01',
  image:
    'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 11 5-5 4 4 3-3 5 5M9 9.5h.01',
  shield: 'M12 3 5 6v5.5c0 4.2 2.8 7.5 7 9.5 4.2-2 7-5.3 7-9.5V6l-7-3Z',
  external: 'M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
} as const;

export type AIconName = keyof typeof PATHS;

export function AIcon({
  name,
  size = 20,
  className = '',
  ...rest
}: { name: AIconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
