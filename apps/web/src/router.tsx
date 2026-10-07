import { createBrowserRouter, redirect } from 'react-router';
import { RouteError } from './surfaces/RouteError';
import { Splash } from './surfaces/Splash';

/**
 * Staff surfaces only (admin console). The TV at /live has its own lean entry (surfaces/live/mount.tsx). The voter app at /vote has its own lean entry
 * (surfaces/vote/mount.tsx) and never loads this router.
 */
export const router = createBrowserRouter([
  { path: '/', loader: () => redirect('/vote'), HydrateFallback: Splash },
  {
    path: '/admin/*',
    lazy: async () => ({ Component: (await import('./surfaces/admin/AdminApp')).AdminApp }),
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
  },
  { path: '*', loader: () => redirect('/vote') },
]);
