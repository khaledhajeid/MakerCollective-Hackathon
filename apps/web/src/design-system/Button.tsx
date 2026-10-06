import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { haptic } from '../lib/haptics';
import { Gear } from './Motifs';
import { spring } from './motion';

type Variant = 'primary' | 'secondary' | 'ghost' | 'onDark';

const STYLES: Record<Variant, string> = {
  primary:
    'bg-purple text-white shadow-[0_10px_22px_-8px_rgb(127_50_217/0.7),inset_0_1px_0_rgb(255_255_255/0.22)] disabled:bg-[#b9a3e0] disabled:shadow-none',
  secondary:
    'bg-surface text-navy ring-[1.5px] ring-inset ring-line shadow-[0_2px_6px_-2px_rgb(0_0_123/0.18)] disabled:text-muted',
  ghost: 'bg-transparent text-royal',
  onDark:
    'bg-white text-navy shadow-[0_12px_26px_-10px_rgb(0_0_40/0.6),inset_0_-3px_0_rgb(0_0_123/0.08)] disabled:opacity-60',
};

interface ButtonProps {
  children: ReactNode;
  variant?: Variant;
  size?: 'lg' | 'md';
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * The one button. 56 px (thumb-sized) by default; presses down with a spring and a haptic tick. While `loading`
 * it stays focusable-but-inert (aria-busy) so a double tap can never submit twice.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  className = '',
  ...aria
}: ButtonProps) {
  const inert = disabled || loading;
  return (
    <m.button
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={inert || undefined}
      disabled={disabled}
      whileTap={inert ? undefined : { scale: 0.96 }}
      transition={spring.press}
      onClick={() => {
        if (inert) return;
        haptic('tap');
        onClick?.();
      }}
      className={`relative inline-flex w-full select-none items-center justify-center gap-2.5 rounded-[var(--radius-control)] px-6 font-bold transition-colors duration-150 ${
        size === 'lg' ? 'min-h-14 text-[1.0625rem]' : 'min-h-12 text-base'
      } ${STYLES[variant]} ${className}`}
      {...aria}
    >
      {loading && <Gear size={20} />}
      <span className="min-w-0 text-balance">{children}</span>
    </m.button>
  );
}
