import type { ReactNode } from 'react';
import { Icon } from '../../../design-system/Icon';
import { Logo } from '../../../design-system/Logo';
import { Rings } from '../../../design-system/Motifs';
import { useI18n } from '../../../i18n';
import { goBack } from '../../../lib/nav';
import { useVoter } from '../store';

/** The language switch: always visible, one tap, labelled in the language you would switch TO. */
export function LanguageToggle({ onDark = false }: { onDark?: boolean }) {
  const { locale, setLocale, d } = useI18n();
  const target = locale === 'ar' ? 'en' : 'ar';
  return (
    <button
      type="button"
      lang={target}
      onClick={() => setLocale(target)}
      className={`min-h-12 rounded-full px-4 text-sm font-bold ring-[1.5px] ring-inset transition-transform active:scale-95 ${
        onDark ? 'bg-white/10 text-white ring-white/30' : 'bg-surface text-navy ring-line'
      }`}
    >
      {d.common.switchLanguage}
    </button>
  );
}

export function BackButton({ fallback, onDark = false }: { fallback: string; onDark?: boolean }) {
  const { d } = useI18n();
  return (
    <button
      type="button"
      aria-label={d.common.back}
      onClick={() => goBack(fallback)}
      className={`grid size-12 place-items-center rounded-full ring-[1.5px] ring-inset transition-transform active:scale-90 ${
        onDark ? 'bg-white/10 text-white ring-white/30' : 'bg-surface text-navy ring-line'
      }`}
    >
      <Icon name="back" flip />
    </button>
  );
}

/** Slim top bar for light screens. */
export function TopBar({ back, children }: { back?: string; children?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))]">
      {back ? <BackButton fallback={back} /> : <span />}
      <div className="flex items-center gap-2">
        {children}
        <LanguageToggle />
      </div>
    </header>
  );
}

/** Navy brand surface with the spiral rings; used for welcome, hub header, finish and closed screens. */
export function Hero({
  children,
  className = '',
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'teal';
}) {
  return (
    <div
      className={`relative isolate overflow-hidden text-white ${
        tone === 'teal' ? 'hero-bg-teal' : 'hero-bg'
      } ${className}`}
    >
      <Rings
        className="rings-turn pointer-events-none absolute -end-40 -top-36 -z-10 w-[34rem] max-w-none"
        style={{ opacity: 0.9 }}
      />
      {children}
    </div>
  );
}

export function BrandMark({ className = 'w-40' }: { className?: string }) {
  const { d } = useI18n();
  return <Logo variant="white" alt={d.common.logoAlt} className={className} />;
}

/** Fixed offline strip: states what is true and what happens next, never blocks the page. */
export function OfflineBanner() {
  const { online } = useVoter();
  const { d } = useI18n();
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 flex items-center justify-center gap-2 bg-ink px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-center text-sm font-bold text-white"
      style={{ zIndex: 'var(--z-banner)' }}
    >
      <Icon name="signal" size={18} className="shrink-0 text-yellow" />
      {d.common.offline}
    </div>
  );
}

/** Bottom action bar that stays in the thumb zone and clears the home indicator. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 mt-auto bg-gradient-to-t from-canvas from-70% to-transparent px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6"
      style={{ zIndex: 'var(--z-sticky)' }}
    >
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton rounded-[var(--radius-card)] ${className}`} aria-hidden="true" />
  );
}

/** Same navy + chevron pulse as the static page in index.html, so the hand-over from HTML to React is seamless. */
export function BootSplash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-navy" role="status" aria-label="Loading">
      <svg viewBox="66 990 190 56" className="w-[4.5rem] animate-pulse" aria-hidden="true">
        <path fill="#74dccf" d="M252.45 1017.69 207.89 991.96v51.45Z" />
        <path fill="#4a68d8" d="M182.95 1017.69 138.39 991.96v51.45Z" />
        <path fill="#fff" d="M113.45 1017.69 68.89 991.96v51.45Z" />
      </svg>
    </div>
  );
}
