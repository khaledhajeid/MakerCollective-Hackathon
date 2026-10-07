import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { nextCategoryId } from './model';

const REDUCED = '(prefers-reduced-motion: reduce)';
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Wall-clock `Date.now()` that re-renders its caller every `ms` (countdowns, the offline chip). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * Eases a displayed integer toward `target` (ease-out quart). With reduced motion it simply shows the target.
 * `from` starts the first run somewhere else (the winner count climbing from 0 in the ceremony).
 */
export function useCountUp(
  target: number,
  { duration = 900, delay = 0, from }: { duration?: number; delay?: number; from?: number } = {},
): number {
  const reduced = useReducedMotion();
  const shown = useRef(from ?? target);
  const [value, setValue] = useState(from ?? target);
  useEffect(() => {
    const start = shown.current;
    if (start === target) return;
    const t0 = performance.now() + delay;
    const span = reduced ? 0 : duration;
    let raf = 0;
    const step = (t: number) => {
      const p = span === 0 ? 1 : Math.min(1, Math.max(0, (t - t0) / span));
      const v = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 4)));
      shown.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay, reduced]);
  return value;
}

/**
 * Which category holds the stage. Advances every `dwellMs`; the dwell timer depends on the list's CONTENT (not its
 * identity) so a new frame every second never resets it. `jumpTo` lets the reveal ceremony land on its category.
 */
export function useRotation(ids: readonly string[], dwellMs: number, hold: boolean) {
  const [state, setState] = useState<{ id: string | null; epoch: number }>({ id: null, epoch: 0 });
  const key = ids.join('|');
  const activeId = state.id !== null && ids.includes(state.id) ? state.id : (ids[0] ?? null);
  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (hold || list.length < 2) return;
    const t = setTimeout(
      () => setState((s) => ({ id: nextCategoryId(list, activeId), epoch: s.epoch + 1 })),
      dwellMs,
    );
    return () => clearTimeout(t);
  }, [activeId, state.epoch, key, hold, dwellMs]);
  return {
    activeId,
    epoch: state.epoch,
    jumpTo: useCallback((id: string) => setState((s) => ({ id, epoch: s.epoch + 1 })), []),
  };
}
