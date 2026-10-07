import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApiError } from '../lib/api';
import { router } from '../router';

/** A 401 from any call means the session ended (idle, expired, signed out elsewhere): show the sign-in screen. */
const onApiError = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401 && err.code === 'UNAUTHENTICATED')
    queryClient.setQueryData(['admin', 'session'], { authenticated: false });
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
