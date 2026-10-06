import { api } from './api';

/**
 * The first screen depends on four reads (venue gate, voting window, session, catalog). They are started from the
 * tiny entry script, in parallel with the app bundle download, instead of after it — on a slow 4G phone that
 * overlap is most of the time between "HTML arrived" and "first real screen". `take()` hands them to the store
 * exactly once; a failed read is simply re-fetched by the store, so this can only make things faster.
 */
interface Preboot {
  access: ReturnType<typeof api.accessStatus>;
  voting: ReturnType<typeof api.votingStatus>;
  session: ReturnType<typeof api.session>;
  catalog: ReturnType<typeof api.catalog>;
}

let pending: Preboot | null = null;

export function startPreboot(): void {
  const swallow = <T>(p: Promise<T>) => {
    p.catch(() => undefined); // avoid an unhandled-rejection warning if nobody has consumed it yet
    return p;
  };
  pending = {
    access: swallow(api.accessStatus()),
    voting: swallow(api.votingStatus()),
    session: swallow(api.session()),
    catalog: swallow(api.catalog()),
  };
}

export function takePreboot(): Preboot | null {
  const p = pending;
  pending = null;
  return p;
}
