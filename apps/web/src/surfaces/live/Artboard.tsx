import { useEffect, useState, type ReactNode } from 'react';

export const ART_W = 1920;
export const ART_H = 1080;

const fit = () => Math.min(window.innerWidth / ART_W, window.innerHeight / ART_H);

/**
 * The TV is designed once at 1920x1080 and scaled to whatever screen it lands on (a 4K TV doubles it; a laptop
 * on an HDMI mirror shrinks it). A screen that is not 16:9 gets navy bars rather than a distorted layout.
 */
export function Artboard({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div className="fixed inset-0 cursor-none overflow-hidden bg-navy-deep" dir="rtl" lang="ar">
      <div
        className="absolute left-1/2 top-1/2 origin-center"
        style={{
          width: ART_W,
          height: ART_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
