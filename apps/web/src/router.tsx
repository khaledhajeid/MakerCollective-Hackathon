import { createBrowserRouter, redirect } from 'react-router';
import { RouteError } from './surfaces/RouteError';
import { Splash } from './surfaces/Splash';

/**
 * Staff surfaces only (admin console, TV dashboard). The voter app at /vote has its own lean entry
 * (surfaces/vote/mount.tsx) and never loads this router.
 */
export const router = createBrowserRouter([
  { path: '/', loader: () => redirect('/vote'), HydrateFallback: Splash },
  {
    path: '/live/*',
    lazy: async () => ({ Component: (await import('./surfaces/live/LiveApp')).LiveApp }),
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
  },
  {
    path: '/admin/*',
    lazy: async () => ({ Component: (await import('./surfaces/admin/AdminApp')).AdminApp }),
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
  },
  { path: '*', loader: () => redirect('/vote') },
]);
