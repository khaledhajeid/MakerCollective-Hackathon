const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A small physical tick on supported devices (Android Chrome). iOS Safari has no vibration API, so on
 * iPhone this is silently a no-op — haptics are an enhancement, never the only feedback.
 */
export function haptic(kind: 'tap' | 'success' | 'warn' = 'tap'): void {
  if (reduced() || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(kind === 'tap' ? 8 : kind === 'success' ? [14, 40, 22] : [30, 50, 30]);
}
