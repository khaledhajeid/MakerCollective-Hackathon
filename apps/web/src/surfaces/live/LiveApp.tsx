import type { ResultsFrame } from '@mc/shared';
import { useCallback, useEffect, useRef } from 'react';
import { Bi, SlowGear } from './parts';
import { Artboard } from './Artboard';
import { Ceremony } from './Ceremony';
import { Header } from './Header';
import { Pairing } from './Pairing';
import { Rail } from './Rail';
import { SealedScreen, WaitingScreen } from './Screens';
import { Stage } from './Stage';
import { useNow, useRotation } from './hooks';
import { DWELL_MS, OFFLINE_CHIP_MS, screenFor, stageCategories } from './model';
import { useDisplay } from './useDisplay';

function Connecting() {
  return (
    <main className="tv-ground flex size-full items-center justify-center gap-[64px] text-white">
      <SlowGear size={260} className="text-white/80" />
      <Bi
        k="connecting"
        arClass="text-[80px] font-bold leading-[1.2]"
        enClass="text-[44px] leading-[1.15] text-white/72"
      />
    </main>
  );
}

type Display = ReturnType<typeof useDisplay>;

function Screen({ d, frame }: { d: Display; frame: ResultsFrame }) {
  const now = useNow(1000);
  const screen = screenFor(frame);
  const cats = stageCategories(frame);
  const ceremonyCategory = d.reveal
    ? (cats.find((c) => c.id === d.reveal!.categoryId) ?? null)
    : null;
  const rotation = useRotation(
    cats.map((c) => c.id),
    DWELL_MS,
    ceremonyCategory !== null,
  );
  const active = cats.find((c) => c.id === rotation.activeId) ?? null;
  const rotating = cats.length > 1 && ceremonyCategory === null;

  const { jumpTo } = rotation;
  const { clearReveal } = d;
  const revealed = d.reveal?.categoryId;
  const revealedRef = useRef(revealed);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);
  /** Ceremony over: the stage now shows that category's final standings. */
  const finish = useCallback(() => {
    if (revealedRef.current) jumpTo(revealedRef.current);
    clearReveal();
  }, [jumpTo, clearReveal]);

  const offline =
    d.link === 'offline' && d.offlineSince !== null && now - d.offlineSince > OFFLINE_CHIP_MS;

  return (
    <main className="tv-ground relative size-full overflow-hidden text-white">
      <div className="tv-burnin flex size-full flex-col gap-[16px] px-[64px] py-[32px]">
        <Header frame={frame} serverNow={now + d.clockOffset} offline={offline} />
        <div className="min-h-0 flex-1">
          {screen === 'sealed' && <SealedScreen />}
          {screen === 'waiting' && <WaitingScreen />}
          {screen === 'stage' && active && (
            <Stage
              key={active.id}
              category={active}
              live={frame.mode === 'LIVE'}
              segments={{
                count: cats.length,
                index: Math.max(
                  0,
                  cats.findIndex((c) => c.id === active.id),
                ),
                epoch: rotation.epoch,
                rotating,
              }}
            />
          )}
        </div>
        <Rail
          categories={frame.categories}
          activeId={screen === 'stage' ? rotation.activeId : null}
          epoch={rotation.epoch}
          rotating={rotating && screen === 'stage'}
          showQr={screen !== 'waiting'}
        />
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
