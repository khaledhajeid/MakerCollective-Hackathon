import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { ResultCategory, ResultExhibitor } from '@mc/shared';
import { Rings } from '../../design-system/Motifs';
import { Bi, Chevron, Names, Photo, SlowGear } from './parts';
import { CEREMONY_MS, podiumOf } from './model';
import { Ticker } from './Ticker';

const at = (seconds: number): CSSProperties => ({ ['--d' as string]: `${seconds}s` });

type WinnerSize = {
  photo: number;
  radius: number;
  ar: string;
  en: string;
  count: string;
  card: number;
};
const SIZES: Record<'one' | 'few' | 'many', WinnerSize> = {
  one: {
    photo: 420,
    radius: 48,
    ar: 'text-[104px] leading-[1.2]',
    en: 'text-[56px] leading-[1.15]',
    count: 'text-[240px]',
    card: 0,
  },
  few: {
    photo: 260,
    radius: 36,
    ar: 'text-[64px] leading-[1.25]',
    en: 'text-[40px] leading-[1.15]',
    count: 'text-[96px]',
    card: 520,
  },
  many: {
    photo: 150,
    radius: 28,
    ar: 'text-[56px] leading-[1.25]',
    en: 'text-[40px] leading-[1.15]',
    count: 'text-[72px]',
    card: 540,
  },
};
const sizeFor = (n: number): WinnerSize => (n === 1 ? SIZES.one : n <= 3 ? SIZES.few : SIZES.many);

function Winner({ ex, size, solo }: { ex: ResultExhibitor; size: WinnerSize; solo: boolean }) {
  return (
    <div
      className={`cer-in flex items-center ${solo ? 'gap-[64px]' : 'flex-col gap-[16px] text-center'}`}
      style={at(1.7)}
    >
      <div className="relative shrink-0">
        <span
          aria-hidden="true"
          className="cer-glow absolute -inset-[24px] rounded-[64px] bg-yellow/90"
        />
        <Photo ex={ex} size={size.photo} radius={size.radius} ring="ring-0" className="relative" />
      </div>
      <div
        className={solo ? 'min-w-0 max-w-[820px]' : 'min-w-0'}
        style={solo ? undefined : { width: size.card }}
      >
        {solo && (
          <Bi
            k="winner"
            arClass="text-[56px] font-bold leading-[1.25] text-yellow"
            enClass="text-[40px] leading-[1.15] text-white/72"
            className="mb-[18px]"
          />
        )}
        <Names
          nameAr={ex.nameAr}
          nameEn={ex.nameEn}
          arClass={`font-bold ${size.ar}`}
          enClass={`text-white/80 ${size.en}`}
          centered={!solo}
        />
        {!solo && <Count ex={ex} size={size.count} />}
      </div>
      {solo && (
        <div className="shrink-0 text-center">
          <Count ex={ex} size={size.count} />
          <Bi
            k="votes"
            arClass="text-[48px] font-bold leading-[1.2]"
            enClass="text-[40px] leading-[1.1] text-white/72"
            className="mt-[8px]"
          />
        </div>
      )}
    </div>
  );
}

/** The winner's tally climbs from zero once the photo has landed. */
const Count = ({ ex, size }: { ex: ResultExhibitor; size: string }) => (
  <Ticker
    value={ex.votes}
    from={0}
    duration={2200}
    delay={2400}
    nudge={false}
    className={`inline-block font-black leading-none text-yellow ${size}`}
  />
);

/**
 * Full-screen announcement of one category's winner (or joint winners), then second and third place.
 * It runs once, for CEREMONY_MS, and hands the stage back showing that category's final standings.
 */
export function Ceremony({ category, onDone }: { category: ResultCategory; onDone: () => void }) {
  const { winners, runnersUp } = podiumOf(category);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const out = setTimeout(() => setLeaving(true), CEREMONY_MS - 600);
    const done = setTimeout(onDone, CEREMONY_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      role="status"
      className={`tv-ground absolute inset-0 z-50 overflow-hidden ${leaving ? 'cer-leave' : 'cer'}`}
    >
      <Rings
        className="rings-turn absolute left-1/2 top-1/2 size-[1500px] -translate-x-1/2 -translate-y-1/2"
        stroke="rgb(255 255 255 / 0.07)"
      />
      <SlowGear size={900} className="absolute -end-[240px] -top-[260px] text-white/10" />

      <div className="relative flex h-full flex-col px-[96px] pb-[48px] pt-[52px]">
        <div className="cer-in flex items-center gap-[26px]" style={at(0.3)}>
          <Chevron color={category.color} size={54} />
          <span lang="ar" className="text-[72px] font-bold leading-[1.25]">
            {category.nameAr}
          </span>
          <bdi lang="en" className="text-[44px] leading-[1.2] text-white/72">
            {category.nameEn}
          </bdi>
        </div>

        {winners.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Bi
              k="noVotesYet"
              arClass="text-[80px] font-bold leading-[1.25]"
              enClass="text-[44px] leading-[1.15] text-white/72"
              className="text-center"
            />
          </div>
        ) : (
          <>
            {winners.length > 1 && (
              <div className="cer-in mt-[26px]" style={at(1.0)}>
                <Bi
                  k="jointWinners"
                  arClass="text-[56px] font-bold leading-[1.25] text-yellow"
                  enClass="text-[40px] leading-[1.15] text-white/72"
                />
              </div>
            )}
            <div
              className={`flex flex-1 items-center justify-center ${
                winners.length > 1 ? 'flex-wrap content-center gap-x-[48px] gap-y-[28px]' : ''
              }`}
            >
              {winners.map((w) => (
                <Winner
                  key={w.id}
                  ex={w}
                  size={sizeFor(winners.length)}
                  solo={winners.length === 1}
                />
              ))}
            </div>
            {runnersUp.length > 0 && (
              <div className="flex shrink-0 gap-[28px]">
                {runnersUp.slice(0, 2).map((r, i) => (
                  <div
                    key={r.id}
                    className="cer-in flex min-w-0 flex-1 items-center gap-[24px] rounded-[32px] bg-white/[0.09] p-[20px]"
                    style={at(5.2 + i * 0.5)}
                  >
                    <span className="num w-[64px] text-center text-[56px] font-black leading-none text-white/70">
                      {r.rank}
                    </span>
                    <Photo ex={r} size={132} radius={26} />
                    <Names
                      nameAr={r.nameAr}
                      nameEn={r.nameEn}
                      arClass="text-[56px] font-bold leading-[1.25]"
                      enClass="text-[40px] leading-[1.1] text-white/72"
                      className="flex-1"
                    />
                    <Ticker
                      value={r.votes}
                      nudge={false}
                      className="text-[72px] font-black leading-none"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
