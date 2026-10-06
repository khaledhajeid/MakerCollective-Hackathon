import { useSyncExternalStore } from 'react';

/**
 * A ~1 KB History-API router for the voter app. The full router (plus its data layer) is ~30 KB gzipped, which
 * the 150 KB voter budget cannot spare. Back/forward (Android's system back!) work because every screen is a
 * real history entry; direction (for the slide transition) is derived from a monotonically increasing index.
 */
export interface Loc {
  path: string;
  /** How we got here — drives the transition direction. */
  dir: 'forward' | 'back' | 'none';
}

const BASE = '/vote';
let idx = 0;
let current: Loc = { path: normalise(window.location.pathname), dir: 'none' };
const listeners = new Set<() => void>();

function normalise(p: string): string {
  const trimmed = p.replace(/\/+$/, '') || '/';
  return trimmed === '/' ? BASE : trimmed;
}

function emit(dir: Loc['dir']) {
  current = { path: normalise(window.location.pathname), dir };
  listeners.forEach((l) => l());
}

export function initNav(): void {
  const state = history.state as { idx?: number } | null;
  idx = state?.idx ?? 0;
  history.replaceState({ idx }, '', normalise(window.location.pathname));
  current = { path: normalise(window.location.pathname), dir: 'none' };
  window.addEventListener('popstate', (e) => {
    const next = (e.state as { idx?: number } | null)?.idx ?? 0;
    const dir = next < idx ? 'back' : next > idx ? 'forward' : 'none';
    idx = next;
    emit(dir);
  });
}

export function navigate(to: string, opts: { replace?: boolean; dir?: Loc['dir'] } = {}): void {
  if (normalise(to) === current.path && !opts.replace) return;
  if (opts.replace) {
    history.replaceState({ idx }, '', to);
    emit(opts.dir ?? 'none');
  } else {
    idx += 1;
    history.pushState({ idx }, '', to);
    emit('forward');
  }
}

export function goBack(fallback: string): void {
  if (idx > 0) history.back();
  else navigate(fallback, { replace: true });
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export function useLoc(): Loc {
  return useSyncExternalStore(subscribe, () => current);
}
