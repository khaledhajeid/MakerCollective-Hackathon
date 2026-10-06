interface LogoProps {
  variant?: 'color' | 'white';
  className?: string;
}

/** Official MC2026 bilingual lockup, extracted as vector from the brand guidelines PDF. */
export function Logo({ variant = 'color', className }: LogoProps) {
  const src = variant === 'white' ? '/brand/logo-lockup-white.svg' : '/brand/logo-lockup.svg';
  return <img src={src} alt="The Maker Collective 2026 — ملتقى الصناع" className={className} />;
}
