import { useEffect, useMemo, useState } from 'react';
import type { ResultCategory, ResultExhibitor } from '@mc/shared';
import { Rings } from '../../design-system/Motifs';
import { Bi, Chevron, FitNames, Photo, PlaceBadge, VotesUnit, placeOf } from './parts';
import { CEREMONY_TIERS, fitName } from './layout';
import {
  CEREMONY_LEAVE_MS,
  CEREMONY_MS,
  CEREMONY_PODIUM_AT,
  CEREMONY_WINNER_AT,
  podiumOf,
} from './model';
import { Ticker } from './Ticker';

type Phase = 'intro' | 'winner' | 'podium';

/** Size of one winner's photo, card and type, by how many share first place. */
const LAYOUT = {
  one: { photo: 460, radius: 60, name: { w: 880, h: 380 }, count: 'text-[170px]', tiers: 0 },
  few: { photo: 250, radius: 36, name: { w: 520, h: 200 }, count: 'text-[104px]', tiers: 4 },
  many: { photo: 150, radius: 28, name: { w: 520, h: 150 }, count: 'text-[72px]', tiers: 5 },
} as const;
const layoutFor = (n: number) => (n === 1 ? LAYOUT.one : n <= 3 ? LAYOUT.few : LAYOUT.many);

/** The winner's tally climbs from zero once the winner has landed. */
const Count = ({ ex, className }: { ex: ResultExhibitor; className: string }) => (
  <Ticker
    value={ex.votes}
    from={0}
    duration={2000}
    delay={700}
    nudge={false}
    className={`inline-block font-black leading-none text-yellow ${className}`}
  />
);

function Winner({ ex, count }: { ex: ResultExhibitor; count: number }) {
  const L = layoutFor(count);
  const solo = count === 1;
  const fit = useMemo(
    () => fitName(ex.nameAr, ex.nameEn, L.name.w, L.name.h, CEREMONY_TIERS.slice(L.tiers)),
    [ex.nameAr, ex.nameEn, L.name.w, L.name.h, L.tiers],
  );
  return (
    <div
      className={`cer-in flex items-center ${solo ? 'gap-[64px]' : 'flex-col gap-[18px] text-center'}`}
    >
      <div className="relative shrink-0">
        <span
          aria-hidden="true"
          className="cer-glow absolute -inset-[24px] rounded-[72px] bg-yellow"
        />
        <Photo ex={ex} size={L.photo} radius={L.radius} ring="ring-0" className="relative" />
      </div>
      <div className="min-w-0" style={{ width: solo ? undefined : L.name.w }}>
        <FitNames
          nameAr={ex.nameAr}
          nameEn={ex.nameEn}
          fit={fit}
          enClass="text-white/80"
          centered={!solo}
          className={solo ? '' : 'mb-[10px]'}
        />
        {!solo && (
          <>
            <Count ex={ex} className={L.count} />
            <VotesUnit large className="mt-[6px] block text-white/80" />
          </>
        )}
      </div>
      {solo && (
        <div className="shrink-0 text-center">
          <Count ex={ex} className={L.count} />
          <Bi
            k="votes"
            arClass="text-[48px] font-bold leading-[1.3]"
            enClass="text-[40px] leading-[1.1] text-dim"
            className="mt-[8px]"
          />
        </div>
      )}
    </div>
  );
}

function Runner({ ex, index }: { ex: ResultExhibitor; index: number }) {
  const fit = useMemo(
    () => fitName(ex.nameAr, ex.nameEn, 520, 150, CEREMONY_TIERS.slice(4)),
    [ex.nameAr, ex.nameEn],
  );
  return (
    <div
      className={`cer-in flex min-w-0 flex-1 items-center gap-[24px] rounded-[32px] p-[22px] ${
        placeOf(ex.rank) === 2
          ? 'bg-white/[0.2] text-white ring-1 ring-inset ring-white/30'
          : 'bg-white/[0.08] text-white ring-1 ring-inset ring-white/15'
      }`}
      style={{ ['--d' as string]: `${index * 0.45}s` }}
    >
      <PlaceBadge rank={ex.rank} size={84} />
      <Photo ex={ex} size={150} radius={28} />
      <FitNames
        nameAr={ex.nameAr}
        nameEn={ex.nameEn}
        fit={fit}
        enClass="text-white/80"
        className="flex-1"
      />
      <span className="flex shrink-0 flex-col items-end gap-[10px]">
        <Ticker value={ex.votes} nudge={false} className="text-[72px] font-black leading-none" />
        <VotesUnit large className="text-white/80" />
      </span>
    </div>
  );
}

/**
 * Full-screen announcement of one category's winner (or joint winners), then second and third place.
 *
 * It is an OPAQUE curtain: it rises over the board in one piece (a slide, never a fade, so the board cannot show
 * through) and leaves the same way. Behind it the board is inert and shows that category still sealed, so nothing
 * of the result can be seen before the announcement. Three beats, timed by one effect: the announcement, the
 * winner, then the runners-up. The curtain runs once, for CEREMONY_MS, and hands back the board.
 */
export function Ceremony({ category, onDone }: { category: ResultCategory; onDone: () => void }) {
  const { winners, runnersUp } = podiumOf(category);
  const [phase, setPhase] = useState<Phase>('intro');
  const [leaving, setLeaving] = useState(false);
  const podium = runnersUp.length > 0;
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase('winner'), CEREMONY_WINNER_AT),
      setTimeout(() => setPhase('podium'), CEREMONY_PODIUM_AT),
      setTimeout(() => setLeaving(true), CEREMONY_MS - CEREMONY_LEAVE_MS),
      setTimeout(onDone, CEREMONY_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  const joint = winners.length > 1;
  const showWinners = phase !== 'intro';
  return (
    <div
      role="status"
      className={`tv-ground-ceremony tv-dark absolute inset-0 z-50 overflow-hidden text-white ${
        leaving ? 'cer-leave' : 'cer'
      }`}
    >
      <Rings
        className="rings-turn absolute left-1/2 top-1/2 size-[1500px] -translate-x-1/2 -translate-y-1/2"
        stroke="rgb(255 255 255 / 0.05)"
      />

      <div className="relative flex h-full flex-col px-[96px] pb-[56px] pt-[56px]">
        <div className="flex items-center gap-[26px]">
          <Chevron color="#ffffff" size={54} edge="transparent" />
          <span lang="ar" className="text-[72px] font-bold leading-[1.3]">
            {category.nameAr}
          </span>
          <bdi lang="en" className="text-[44px] leading-[1.2] text-dim">
            {category.nameEn}
          </bdi>
        </div>

        {winners.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Bi
              k="noVotesYet"
              arClass="text-[80px] font-bold leading-[1.3]"
              enClass="text-[44px] leading-[1.15] text-dim"
              className="text-center"
            />
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {joint && showWinners && (
              <div className="cer-in mt-[44px]">
                <Bi
                  k="jointWinners"
                  arClass="text-[56px] font-bold leading-[1.3] text-yellow"
                  enClass="text-[40px] leading-[1.15] text-dim"
                />
              </div>
            )}

            {!showWinners && (
              <div key="intro" className="cer-in absolute inset-0 flex items-center justify-center">
                <Bi
                  k={joint ? 'jointWinners' : 'winnerIs'}
                  arClass={`text-[136px] font-bold leading-[1.3] ${joint ? 'text-yellow' : 'text-white'}`}
                  enClass="text-[64px] leading-[1.15] text-white/80"
                  className="text-center"
                />
              </div>
            )}

            {showWinners && (
              <div
                className={`flex flex-1 items-center justify-center ${
                  joint ? 'flex-wrap content-center gap-x-[48px] gap-y-[28px]' : ''
                }`}
              >
                {winners.map((w) => (
                  <Winner key={w.id} ex={w} count={winners.length} />
                ))}
              </div>
            )}

            {/* The runners-up have their own reserved strip, so the winner never moves when they arrive. */}
            {podium && (
              <div className="flex h-[224px] shrink-0 gap-[28px]">
                {phase === 'podium' &&
                  runnersUp.slice(0, 2).map((r, i) => <Runner key={r.id} ex={r} index={i} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
