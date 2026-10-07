import type { QueryClient } from '@tanstack/react-query';
import { setCsrf } from './api';

/** The one cache key for "who is signed in". Kept apart from the `['admin', …]` data keys so a data refresh never touches it. */
export const SESSION_KEY = ['session'] as const;

/**
 * Ends the signed-in state in the browser: forgets the CSRF token and EVERY cached answer (audit log, SMS inbox, user
 * list, live counts…), so the next person at this screen never sees the previous one's data.
 */
export function endSession(qc: QueryClient) {
  setCsrf('');
  // Not `qc.clear()`: that would also drop the session query the screen is watching, and the sign-in screen would never appear.
  void qc.cancelQueries();
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
  qc.getMutationCache().clear();
  qc.setQueryData(SESSION_KEY, { authenticated: false });
}
