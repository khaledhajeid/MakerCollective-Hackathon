import { AnimatePresence, m } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { MotionProvider, ease } from '../../design-system/motion';
import { I18nProvider, useI18n } from '../../i18n';
import { navigate, useLoc, type Loc } from '../../lib/nav';
import { BootSplash, OfflineBanner } from './components/Chrome';
import { CategoryScreen } from './screens/Category';
import { Code } from './screens/Code';
import { Details } from './screens/Details';
import { Finish } from './screens/Finish';
import { Hub } from './screens/Hub';
import { BootError, ClosedScreen, GateScreen } from './screens/System';
import { Welcome } from './screens/Welcome';
import { VoterProvider, useVoter, votedCount } from './store';

interface Resolved {
  key: string;
  node: ReactNode;
  redirect?: string;
}

/** Decides which screen the (access, voting window, session, URL) combination shows. Pure; redirects are explicit. */
function useResolved(loc: Loc): Resolved {
  const { boot, access, voting, visitor, categories, votes, challenge } = useVoter();
  const path = loc.path;

  if (boot === 'error') return { key: 'boot-error', node: <BootError /> };
  if (boot === 'loading' || !access || !voting) return { key: 'boot', node: <BootSplash /> };

  // Venue network first: nothing else is meaningful off-site (F10/F11).
  if (!access.allowed) return { key: 'gate', node: <GateScreen /> };
  if (voting.state !== 'OPEN') return { key: 'closed', node: <ClosedScreen /> };

  const total = categories.data?.length ?? 0;
  const allDone = total > 0 && votedCount(categories.data ?? [], votes) >= total;

  if (!visitor) {
    if (path === '/vote/details') return { key: 'details', node: <Details /> };
    if (path === '/vote/code')
      return challenge
        ? { key: 'code', node: <Code /> }
        : { key: 'redirect', node: null, redirect: '/vote/details' };
    if (path === '/vote') return { key: 'welcome', node: <Welcome /> };
    return { key: 'redirect', node: null, redirect: '/vote' };
  }

  if (path === '/vote/done')
    return allDone
      ? { key: 'done', node: <Finish /> }
      : { key: 'redirect', node: null, redirect: '/vote' };
  const cat = /^\/vote\/c\/([0-9a-f-]{36})$/.exec(path);
  if (cat) return { key: `cat-${cat[1]}`, node: <CategoryScreen id={cat[1]!} /> };
  if (path === '/vote') return { key: 'hub', node: <Hub /> };
  return { key: 'redirect', node: null, redirect: '/vote' };
}

const SLIDE = 44;

function Stage() {
  const loc = useLoc();
  const { dir } = useI18n();
  const { key, node, redirect } = useResolved(loc);

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);

  // New screen (and only then — not on every re-render, or a catalog refresh would yank a scrolling visitor back to
  // the top): scroll to the top and move focus to the screen's input (code entry) or its heading, so keyboard and
  // screen-reader users start at the beginning.
  const hasNode = node !== null;
  useEffect(() => {
    if (!hasNode) return;
    window.scrollTo(0, 0);
    const target =
      document.querySelector<HTMLElement>('[data-autofocus]') ??
      document.querySelector<HTMLElement>('[data-screen-title]');
    target?.focus({ preventScroll: true });
  }, [key, hasNode]);

  const sign = dir === 'rtl' ? -1 : 1;
  const enterX =
    loc.dir === 'forward' ? SLIDE * sign : loc.dir === 'back' ? -SLIDE * 0.5 * sign : 0;
  const exitX = loc.dir === 'forward' ? -SLIDE * 0.5 * sign : loc.dir === 'back' ? SLIDE * sign : 0;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {node && (
        <m.main
          key={key}
          initial={{ x: enterX, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: exitX, opacity: 0 }}
          transition={{ duration: 0.3, ease: ease.out }}
          className="min-h-dvh"
        >
          {node}
        </m.main>
      )}
    </AnimatePresence>
  );
}

export function VoteApp() {
  return (
    <I18nProvider>
      <MotionProvider>
        <VoterProvider>
          {/* Desktop/tablet: a phone-width column on brand navy, so the app is judged as designed. */}
          <div className="min-h-dvh md:bg-navy md:py-6">
            <div className="relative mx-auto min-h-dvh max-w-md overflow-x-clip bg-canvas md:min-h-[calc(100dvh-3rem)] md:overflow-hidden md:rounded-[2.5rem] md:shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)]">
              <OfflineBanner />
              <Stage />
            </div>
          </div>
        </VoterProvider>
      </MotionProvider>
    </I18nProvider>
  );
}
