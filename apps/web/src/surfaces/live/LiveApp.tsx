import type { ResultsFrame } from '@mc/shared';
import { useCallback, useEffect, useRef } from 'react';
import { Bi, SlowGear } from './parts';
import { Artboard } from './Artboard';
import { Board } from './Board';
import { Ceremony } from './Ceremony';
import { Footer } from './Footer';
import { Header } from './Header';
import { Pairing } from './Pairing';
import { SealedScreen, WaitingScreen } from './Screens';
import { useOfflineNotice, useRotation } from './hooks';
import { pagesOf } from './layout';
import { PAGE_MS, screenFor } from './model';
import { useDisplay } from './useDisplay';

function Connecting() {
  return (
    <main className="tv-ground tv-dark flex size-full items-center justify-center gap-[64px] text-white">
      <SlowGear size={260} className="text-white/80" />
      <Bi
        k="connecting"
        arClass="text-[80px] font-bold leading-[1.3]"
        enClass="text-[44px] leading-[1.15] text-dim"
      />
    </main>
  );
}

type Display = ReturnType<typeof useDisplay>;

function Screen({ d, frame }: { d: Display; frame: ResultsFrame }) {
  const screen = screenFor(frame);
  const cats = frame.categories;
  const pages = pagesOf(cats);
  const ceremonyCategory = d.reveal
    ? (cats.find((c) => c.id === d.reveal!.categoryId) ?? null)
    : null;
  const ceremonyOn = ceremonyCategory !== null;

  // Up to four categories share the screen; more are shown a page at a time.
  const rotation = useRotation(
    pages.map((_, i) => String(i)),
    PAGE_MS,
    ceremonyOn,
  );
  const pageIndex = Math.min(Number(rotation.activeId ?? 0), Math.max(0, pages.length - 1));
  const shown = pages[pageIndex] ?? [];

  const { jumpTo } = rotation;
  const { clearReveal } = d;
  const revealed = d.reveal?.categoryId;
  const revealedRef = useRef(revealed);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  /** Ceremony over: show the page that holds that category, now with its final standings. */
  const finish = useCallback(() => {
    const id = revealedRef.current;
    if (id) {
      const at = pagesRef.current.findIndex((p) => p.some((c) => c.id === id));
      if (at >= 0) jumpTo(String(at));
    }
    clearReveal();
  }, [jumpTo, clearReveal]);

  const offline = useOfflineNotice(d.link, d.offlineSince);

  return (
    <main className="tv-ground tv-dark relative size-full overflow-hidden text-white">
      {/* Blind Hour: the screen is frozen, and says so with an icy rim. */}
      {frame.mode === 'FROZEN' && !ceremonyOn && <div aria-hidden="true" className="tv-frost" />}
      <div
        className="tv-burnin flex size-full flex-col gap-[12px] px-[48px] py-[24px]"
        inert={ceremonyOn}
        aria-hidden={ceremonyOn || undefined}
      >
        <Header frame={frame} clockOffset={d.clockOffset} offline={offline} />
        <div className="min-h-0 flex-1">
          {screen === 'sealed' && <SealedScreen />}
          {screen === 'waiting' && <WaitingScreen />}
          {screen === 'stage' && (
            <Board
              key={pageIndex}
              categories={shown}
              live={frame.mode === 'LIVE'}
              held={ceremonyCategory?.id ?? null}
            />
          )}
        </div>
        <Footer showQr={screen !== 'waiting'} pages={pages.length} page={pageIndex} />
      </div>

      {ceremonyCategory && d.reveal && (
        <Ceremony key={d.reveal.seq} category={ceremonyCategory} onDone={finish} />
      )}
    </main>
  );
}

export function LiveApp() {
  const d = useDisplay();
  return (
    <Artboard>
      {d.auth === 'unpaired' ? (
        <Pairing issue={d.issue} pairing={d.pairing} onPair={(code) => void d.pair(code)} />
      ) : d.auth === 'ready' && d.frame ? (
        <Screen d={d} frame={d.frame} />
      ) : (
        <Connecting />
      )}
    </Artboard>
  );
}
