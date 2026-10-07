import type { ResultCategory, ResultExhibitor } from '@mc/shared';
import { Bi, Chevron, Names, Photo } from './parts';
import { DWELL_MS, barRatio } from './model';
import { Ticker } from './Ticker';

const ROW_H = 128;
const ROW_GAP = 8;
export const ROWS_H = 5 * ROW_H + 4 * ROW_GAP;

/** One ranked row. The row itself is the bar: its fill is the exhibitor's share of the leader's votes. */
function Row({
  ex,
  index,
  max,
  live,
}: {
  ex: ResultExhibitor;
  index: number;
  max: number;
  live: boolean;
}) {
  const leader = ex.rank === 1;
  return (
    <li
      className="absolute inset-x-0 top-0 transition-transform duration-[900ms] ease-[var(--ease-out-expo)]"
      style={{ height: ROW_H, transform: `translateY(${index * (ROW_H + ROW_GAP)}px)` }}
    >
      <div
        className="tv-row-in relative h-full overflow-hidden rounded-[32px] bg-white/[0.07]"
        style={{ ['--i' as string]: index }}
      >
        <span
          aria-hidden="true"
          className={`absolute inset-0 origin-right transition-[transform,background-color] duration-[900ms] ease-[var(--ease-out-expo)] ${
            leader ? 'bg-yellow' : 'bg-white/[0.15]'
          }`}
          style={{ transform: `scaleX(${leader ? 1 : barRatio(ex.votes, max)})` }}
        />
        <div
          className={`relative grid h-full grid-cols-[84px_104px_minmax(0,1fr)_auto] items-center gap-x-[28px] px-[28px] transition-colors duration-500 ${
            leader ? 'text-navy' : 'text-white'
          }`}
        >
          <span className="num text-center text-[56px] font-black leading-none">{ex.rank}</span>
          <Photo
            ex={ex}
            size={104}
            ring={leader ? 'ring-[3px] ring-navy/25' : 'ring-2 ring-white/25'}
          />
          <Names
            nameAr={ex.nameAr}
            nameEn={ex.nameEn}
            arClass={`font-bold ${leader ? 'text-[60px] leading-[1.2]' : 'text-[56px] leading-[1.25]'}`}
            enClass={`leading-[1.1] ${leader ? 'text-[42px] text-navy/75' : 'text-[40px] text-white/72'}`}
          />
          <Ticker
            value={ex.votes}
            nudge={live}
            className={`min-w-[210px] text-end font-black leading-none ${leader ? 'text-[96px]' : 'text-[72px]'}`}
          />
        </div>
      </div>
    </li>
  );
}

/** The category on stage: title row, then up to five ranked rows. */
export function Stage({
  category,
  live,
  segments,
}: {
  category: ResultCategory;
  /** Votes are still arriving: animate counts. False for frozen / revealed standings. */
  live: boolean;
  segments: { count: number; index: number; epoch: number; rotating: boolean };
}) {
  const max = category.exhibitors[0]?.votes ?? 0;
  return (
    <section aria-label={category.nameEn} className="tv-stage-in flex h-full flex-col gap-[12px]">
      <div className="flex h-[76px] shrink-0 items-center justify-between">
        <h1 className="m-0 flex items-center gap-[22px]">
          <Chevron color={category.color} size={44} />
          <span lang="ar" className="text-[56px] font-bold leading-[1.25]">
            {category.nameAr}
          </span>
          <bdi lang="en" className="text-[40px] font-normal leading-[1.2] text-white/72">
            {category.nameEn}
          </bdi>
        </h1>
        {segments.count > 1 && (
          <div className="flex items-center gap-[10px]" aria-hidden="true">
            {Array.from({ length: segments.count }, (_, i) => (
              <span
                key={i}
                className="relative h-[10px] w-[64px] overflow-hidden rounded-full bg-white/20"
              >
                {i < segments.index ? (
                  <span className="absolute inset-0 bg-white/70" />
                ) : i === segments.index ? (
                  <span
                    key={segments.epoch}
                    className={
                      segments.rotating
                        ? 'tv-dwell absolute inset-0 bg-turquoise'
                        : 'absolute inset-0 bg-turquoise'
                    }
                    style={segments.rotating ? { animationDuration: `${DWELL_MS}ms` } : undefined}
                  />
                ) : null}
              </span>
            ))}
          </div>
        )}
      </div>

      <ol className="relative m-0 list-none p-0" style={{ height: ROWS_H }}>
        {category.exhibitors.map((ex, i) => (
          <Row key={ex.id} ex={ex} index={i} max={max} live={live} />
        ))}
        {category.exhibitors.length > 0 &&
          Array.from({ length: Math.max(0, 5 - category.exhibitors.length) }, (_, k) => (
            <li
              key={`open-${k}`}
              aria-hidden="true"
              className="tv-stage-in absolute inset-x-0 top-0"
              style={{
                height: ROW_H,
                transform: `translateY(${(category.exhibitors.length + k) * (ROW_H + ROW_GAP)}px)`,
              }}
            >
              <div className="flex h-full items-center rounded-[32px] border-[3px] border-dashed border-white/[0.13] px-[28px]">
                <span className="num w-[84px] text-center text-[56px] font-black leading-none text-white/20">
                  {category.exhibitors.length + k + 1}
                </span>
              </div>
            </li>
          ))}
        {category.exhibitors.length === 0 && (
          <li className="absolute inset-0 flex items-center justify-center text-center text-white/80">
            <Bi k="noVotesYet" className="text-center" />
          </li>
        )}
      </ol>
    </section>
  );
}
