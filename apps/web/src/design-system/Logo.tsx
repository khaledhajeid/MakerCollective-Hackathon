interface LogoProps {
  variant?: 'color' | 'white';
  className?: string;
  alt?: string;
}

/** Official MC2026 bilingual lockup, extracted as vector from the brand guidelines PDF. */
export function Logo({
  variant = 'color',
  className,
  alt = 'The Maker Collective 2026 — ملتقى الصناع',
}: LogoProps) {
  const src = variant === 'white' ? '/brand/logo-lockup-white.svg' : '/brand/logo-lockup.svg';
  return (
    <img src={src} alt={alt} width={836} height={248} className={className} decoding="async" />
  );
}
