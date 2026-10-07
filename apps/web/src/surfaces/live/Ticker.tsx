import { useCountUp } from './hooks';

const fmt = (n: number) => n.toLocaleString('en-US');

/** A number that eases to its new value and nudges when it changes. Western digits, always left-to-right. */
export function Ticker({
  value,
  className = '',
  nudge = true,
  from,
  duration,
  delay,
}: {
  value: number;
  className?: string;
  /** Replay the small "a vote landed" nudge on every change (off for sealed/frozen/final numbers). */
  nudge?: boolean;
  from?: number;
  duration?: number;
  delay?: number;
}) {
  const shown = useCountUp(value, { from, duration, delay });
  return (
    <span className={`num ${className}`}>
      <span key={nudge ? value : 'static'} className={nudge ? 'tv-bump' : ''}>
        {fmt(shown)}
      </span>
    </span>
  );
}
