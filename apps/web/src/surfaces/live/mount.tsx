import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveApp } from './LiveApp';

/**
 * The TV surface: its own lean entry (no router, no query cache, no motion library). It is always Arabic-first
 * and right-to-left, with English alongside in every label, so there is no language switch to build or mis-set.
 */
export function mountLive(root: HTMLElement) {
  document.title = 'MC2026 · Live';
  document.documentElement.lang = 'ar';
  document.documentElement.dir = 'rtl';
  document.documentElement.style.background = '#00004a';
  createRoot(root).render(
    <StrictMode>
      <LiveApp />
    </StrictMode>,
  );
}
