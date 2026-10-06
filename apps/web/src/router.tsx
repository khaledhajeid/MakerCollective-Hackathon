import { createBrowserRouter, redirect } from 'react-router';
import { RouteError } from './surfaces/RouteError';
import { Splash } from './surfaces/Splash';

/**
 * Three surfaces, each its own lazily-loaded chunk: voters never download the
 * dashboard or admin code (plan §2.2 performance budget).
 */
export const router = createBrowserRouter([
  { path: '/', loader: () => redirect('/vote'), HydrateFallback: Splash },
  {
    path: '/vote/*',
    lazy: async () => ({ Component: (await import('./surfaces/vote/VoteApp')).VoteApp }),
    ErrorBoundary: RouteError,
    HydrateFallback: Splash,
  },
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
