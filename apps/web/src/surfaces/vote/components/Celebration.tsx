import { m } from 'motion/react';
import { Rays } from '../../../design-system/Motifs';
import { ease } from '../../../design-system/motion';

/**
 * The reward moment: a turquoise seal springs in, the check draws itself, and brand-coloured rays burst out
 * once. Compositor-only (transform / opacity / stroke offset). With reduced motion it simply appears.
 */
export function Celebration({ size = 112, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size * 1.9, height: size * 1.9 }}
    >
      <Rays className="absolute inset-0 size-full" />
      <m.span
        className="relative grid place-items-center rounded-full bg-turquoise shadow-[0_14px_34px_-10px_rgb(116_220_207/0.9)]"
        style={{ width: size, height: size }}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 18, mass: 0.8 }}
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.5}
          height={size * 0.5}
          fill="none"
          aria-hidden="true"
        >
          <m.path
            d="M5 12.8 9.8 17.5 19 7"
            stroke={dark ? '#00007b' : '#00007b'}
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.22, duration: 0.42, ease: ease.out }}
          />
        </svg>
      </m.span>
    </div>
  );
}
