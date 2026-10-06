import { LazyMotion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/** Animation features load after first paint (own chunk) so they never block the welcome screen. */
const loadFeatures = () => import('./motion-features').then((m) => m.default);

/**
 * `reducedMotion="user"`: with the OS setting on, transform/layout animations are skipped and only opacity
 * changes remain — every animation in the app therefore has its reduced-motion alternative for free.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}

/** Shared timings: crisp, exponential ease-out, nothing bouncy. */
export const spring = {
  press: { type: 'spring', stiffness: 700, damping: 32, mass: 0.6 },
  soft: { type: 'spring', stiffness: 380, damping: 34 },
  sheet: { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 },
} as const;
export const ease = { out: [0.25, 1, 0.5, 1], expo: [0.16, 1, 0.3, 1] } as const;
