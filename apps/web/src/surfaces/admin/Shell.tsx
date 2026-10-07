import { useQueryClient } from '@tanstack/react-query';
import type { AdminRole } from '@mc/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Logo } from '../../design-system/Logo';
import { adminApi, setCsrf } from './api';
import { AIcon, type AIconName } from './icons';
import { Btn, Dialog } from './ui';

interface Item {
  to: string;
  label: string;
  icon: AIconName;
  /** Shown only to this role. The API enforces it too; hiding it just saves a dead end. */
  only?: AdminRole;
}

const ITEMS: Item[] = [
  { to: '/admin', label: 'Overview', icon: 'overview' },
  { to: '/admin/content', label: 'Categories & exhibitors', icon: 'content' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
  { to: '/admin/displays', label: 'TV displays', icon: 'tv' },
  { to: '/admin/visitors', label: 'Visitors', icon: 'users' },
  { to: '/admin/export', label: 'Export', icon: 'download' },
  { to: '/admin/inbox', label: 'SMS inbox', icon: 'inbox', only: 'SUPER_ADMIN' },
  { to: '/admin/audit', label: 'Audit log', icon: 'log', only: 'SUPER_ADMIN' },
  { to: '/admin/users', label: 'Organisers', icon: 'person', only: 'SUPER_ADMIN' },
];

export function Shell({
  admin,
  children,
}: {
  admin: { username: string; role: AdminRole };
  children: ReactNode;
}) {
  const location = useLocation();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const items = ITEMS.filter((i) => !i.only || i.only === admin.role);
  const current =
    [...items, { to: '/admin/account', label: 'Account', icon: 'key' as const }].find((i) =>
      i.to === '/admin'
        ? location.pathname.replace(/\/$/, '') === '/admin'
        : location.pathname.startsWith(i.to),
    )?.label ?? 'Console';

  // A new screen starts at its heading (keyboard and screen-reader users land where the content is).
  useEffect(() => {
    document.title = `${current} · MC2026 console`;
    const h = document.querySelector<HTMLElement>('[data-screen-title]');
    h?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [current, location.pathname]);

  const signOut = () => {
    void adminApi.logout().finally(() => {
      setCsrf('');
      qc.clear();
      qc.setQueryData(['admin', 'session'], { authenticated: false });
    });
  };

  const nav = (
    <nav aria-label="Console" className="flex flex-col gap-1">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.to === '/admin'}
          onClick={() => setMenu(false)}
          className={({ isActive }) =>
            `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-bold transition-colors ${
              isActive
                ? 'bg-white text-navy shadow-[0_1px_3px_rgb(0_0_40/0.35)]'
                : 'text-white/85 hover:bg-white/10'
            }`
          }
        >
          <AIcon name={i.icon} />
          {i.label}
        </NavLink>
      ))}
    </nav>
  );

  const account = (
    <div className="space-y-2 border-t border-white/15 pt-4">
      <NavLink
        to="/admin/account"
        onClick={() => setMenu(false)}
        className={({ isActive }) =>
          `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-bold transition-colors ${
            isActive ? 'bg-white text-navy' : 'text-white/85 hover:bg-white/10'
          }`
        }
      >
        <AIcon name="key" />
        <span className="min-w-0">
          <span className="block truncate">{admin.username}</span>
          <span className="block text-xs font-normal opacity-80">
            {admin.role === 'SUPER_ADMIN' ? 'Super admin' : 'Admin'}
          </span>
        </span>
      </NavLink>
      <button
        type="button"
        onClick={signOut}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-bold text-white/85 transition-colors hover:bg-white/10"
      >
        <AIcon name="logout" />
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]" dir="ltr" lang="en">
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between gap-6 overflow-y-auto bg-navy p-4 lg:flex">
        <div className="space-y-8">
          <Logo
            variant="white"
            className="h-12 w-auto self-start"
            alt="The Maker Collective 2026"
          />
          {nav}
        </div>
        {account}
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-navy px-4 py-2 text-white lg:hidden">
        <Logo variant="white" className="h-9 w-auto" alt="MC2026" />
        <span className="min-w-0 truncate text-sm font-bold">{current}</span>
        <button
          type="button"
          aria-label="Open the menu"
          onClick={() => setMenu(true)}
          className="grid size-11 place-items-center rounded-xl hover:bg-white/10"
        >
          <AIcon name="menu" size={24} />
        </button>
      </header>

      <Dialog open={menu} onClose={() => setMenu(false)} title="Menu">
        <div className="-mx-2 space-y-4 rounded-xl bg-navy p-3">
          {nav}
          {account}
        </div>
        <div className="mt-4 flex justify-end">
          <Btn onClick={() => setMenu(false)}>Close</Btn>
        </div>
      </Dialog>

      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
