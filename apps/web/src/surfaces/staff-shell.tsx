import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from '../lib/api';
import { router } from '../router';
import { endSession, SESSION_KEY } from './admin/session';

/**
 * A 401 from a console call means the session ended (idle, expired, signed out elsewhere): wipe everything cached and
 * show the sign-in screen. The sign-in steps themselves also answer 401 for a WRONG password or code, which must stay
 * on that screen with its message; for those the server is asked who is signed in (an expired half-signed-in session
 * then sends the browser back to the start, a plain typo does not).
 */
const onApiError = (err: unknown) => {
  if (!(err instanceof ApiError) || err.status !== 401 || err.code !== 'UNAUTHENTICATED') return;
  const path = (err as { path?: string }).path ?? '';
  if (path.startsWith('/auth/') && path !== '/auth/session')
    void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
  else endSession(queryClient);
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      // Retry only what may be transient: a refusal (4xx) will not change on the second try.
      retry: (count, err) =>
        count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

/** Admin console + TV dashboard: router and query cache live here, off the voter's critical path. */
export function mountStaff(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
