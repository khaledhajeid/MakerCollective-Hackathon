import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initNav } from '../../lib/nav';
import { VoteApp } from './VoteApp';

/** Voter entry: no router library, no query cache — just React and the app (150 KB budget). */
export function mountVoter(root: HTMLElement) {
  initNav();
  createRoot(root).render(
    <StrictMode>
      <VoteApp />
    </StrictMode>,
  );
}
