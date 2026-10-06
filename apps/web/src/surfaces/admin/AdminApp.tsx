import { Logo } from '../../design-system/Logo';

/** Admin console — auth (Phase 5) and management (Phase 6). */
export function AdminApp() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-12"
      dir="ltr"
      lang="en"
    >
      <Logo className="w-72" />
      <p className="text-muted">Admin console</p>
    </main>
  );
}
