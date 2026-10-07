import type { ResultCategory } from '@mc/shared';
import { Icon } from '../../design-system/Icon';
import { A, Bi, Chevron, E, FitNames, Photo, PlaceBadge, VotesUnit, placeOf } from './parts';
import { COL_H, ROW, planColumn, type RowPlan } from './layout';
import { Ticker } from './Ticker';

/** Rows glide to their new place and their colour eases; the content swaps with a short fade. */
const GLIDE =
  'transition-[transform,height,background-color,color] duration-[800ms] ease-[var(--ease-out-expo)]';

/**
 * What each place looks like: a ladder from loud to quiet. First is solid yellow, second solid white, third a pale
 * glass of the ground. The step is also in the size (height, count) so the order reads even without colour.
 */
const SKIN = {
  1: 'bg-yellow text-navy',
  2: 'bg-white/[0.2] text-white ring-1 ring-inset ring-white/30',
  3: 'bg-white/[0.08] text-white ring-1 ring-inset ring-white/15',
} as const;

/** The one first place: a photo with its medal, the count, and the full name. */
function LeaderBody({ plan, live }: { plan: RowPlan; live: boolean }) {
  const { ex, fit } = plan;
  return (
    <div
      className="tv-swap flex h-full flex-col"
      style={{ padding: `${ROW.ROW_PAD_Y}px ${ROW.PAD_X}px` }}
    >
      <div
        className="flex shrink-0 items-center justify-between"
        style={{ height: ROW.LEADER_TOP }}
      >
        <span
          className="relative shrink-0"
          style={{ width: ROW.LEADER_PHOTO, height: ROW.LEADER_PHOTO }}
        >
          <Photo ex={ex} size={ROW.LEADER_PHOTO} radius={30} ring="ring-0" />
          <PlaceBadge
            rank={1}
            size={64}
            className="absolute -start-[14px] -top-[14px] ring-[4px] ring-navy"
          />
        </span>
        <span className="flex flex-col items-end gap-[8px]">
          <Ticker value={ex.votes} nudge={live} className="text-[96px] font-black leading-none" />
          <VotesUnit large className="text-navy" />
        </span>
      </div>
      <FitNames
        nameAr={ex.nameAr}
        nameEn={ex.nameEn}
        fit={fit}
        enClass="text-navy-dim"
        className="mt-[8px]"
      />
    </div>
  );
}

/** Second and third (and first place when it is shared): medal, full name, count. Nothing else. */
function PlaceBody({ plan, live }: { plan: RowPlan; live: boolean }) {
  const { ex, fit } = plan;
  const place = placeOf(ex.rank);
  const solid = place === 1;
  const size = place === 2 ? 76 : 60;
  return (
    <div
      className="tv-swap relative flex h-full items-center"
      style={{ padding: `${ROW.ROW_PAD_Y}px ${ROW.PAD_X}px`, gap: ROW.COUNT_GAP }}
    >
      <span className="flex shrink-0 justify-center" style={{ width: ROW.RANK_W }}>
        <PlaceBadge rank={ex.rank} size={size} className={solid ? 'ring-[4px] ring-navy' : ''} />
      </span>
      <FitNames
        nameAr={ex.nameAr}
        nameEn={ex.nameEn}
        fit={fit}
        enClass={solid ? 'text-navy-dim' : 'text-dim'}
        className="flex-1"
      />
      <span className="relative flex shrink-0 flex-col items-end" style={{ minWidth: 64 }}>
        <Ticker
          value={ex.votes}
          nudge={live}
          className={`${place === 2 ? 'text-[80px]' : 'text-[60px]'} font-black leading-none`}
        />
        {/* The unit is spoken, not drawn: the leader's count above already says these numbers are votes. */}
        <span className="sr-only">{`${A.votes} ${E.votes}`}</span>
      </span>
    </div>
  );
}

function Head({
  category,
  fit,
  height,
}: {
  category: ResultCategory;
  fit: ReturnType<typeof planColumn>['head']['fit'];
  height: number;
}) {
  return (
    <header
      className="flex shrink-0 items-center gap-[14px] text-white"
      style={{ height, padding: `0 ${ROW.PAD_X / 2}px` }}
    >
      <Chevron color="#ffffff" size={40} edge="transparent" />
      <h2 className="m-0 min-w-0 flex-1 font-normal">
        <FitNames nameAr={category.nameAr} nameEn={category.nameEn} fit={fit} enClass="text-dim" />
      </h2>
    </header>
  );
}

/** One category: its title, then the podium. `sealed` shows the lock instead of any standings. */
function Column({
  category,
  plan,
  live,
  sealed,
}: {
  category: ResultCategory;
  plan: ReturnType<typeof planColumn>;
  live: boolean;
  sealed: boolean;
}) {
  const empty = plan.rows.length === 0;
  return (
    <section
      aria-label={category.nameEn}
      className="tv-col-in relative"
      style={{ width: plan.width, height: COL_H }}
    >
      <Head category={category} fit={plan.head.fit} height={plan.head.height} />
      {sealed ? (
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-center gap-[24px] rounded-[28px] bg-white/[0.06] text-center"
          style={{ top: plan.head.height }}
        >
          <Icon name="lock" size={72} strokeWidth={2.2} className="text-white/75" />
          <Bi
            k="sealed"
            arClass="text-[48px] font-bold leading-[1.3]"
            enClass="text-[36px] leading-[1.2] text-dim"
            className="text-center"
          />
        </div>
      ) : (
        <ol className="m-0 list-none p-0">
          {plan.rows.map((r, i) => (
            <li
              key={r.ex.id}
              className={`tv-row-in absolute inset-x-0 top-0 overflow-hidden rounded-[28px] ${GLIDE} ${
                SKIN[placeOf(r.ex.rank)]
              }`}
              style={{
                height: r.height,
                transform: `translateY(${r.top}px)`,
                ['--i' as string]: i,
              }}
            >
              {r.kind === 'leader' ? (
                <LeaderBody key="leader" plan={r} live={live} />
              ) : (
                <PlaceBody key="place" plan={r} live={live} />
              )}
            </li>
          ))}
          {plan.slots.map((s, i) => (
            <li
              key={`open-${s.rank}`}
              aria-hidden={empty && i === 0 ? undefined : 'true'}
              className={`absolute inset-x-0 top-0 flex items-center rounded-[28px] border-[3px] border-dashed border-white/10 ${GLIDE}`}
              style={{
                height: s.height,
                transform: `translateY(${s.top}px)`,
                padding: `0 ${ROW.PAD_X}px`,
                gap: ROW.COUNT_GAP,
              }}
            >
              <span className="flex shrink-0 justify-center" style={{ width: ROW.RANK_W }}>
                <span
                  aria-hidden="true"
                  className="num inline-flex items-center justify-center rounded-full border-[3px] border-white/30 font-black leading-none text-white/45"
                  style={{ width: 64, height: 64, fontSize: 36 }}
                >
                  {s.rank}
                </span>
              </span>
              {empty && i === 0 && (
                <Bi
                  k="noVotesYet"
                  arClass="text-[36px] font-bold leading-[1.3] [text-wrap:balance]"
                  enClass="text-[28px] leading-[1.2] text-dim"
                  className="min-w-0 flex-1"
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Every category at once, side by side. `held` is the category whose winner is being announced right now: it stays
 * sealed until the ceremony ends, so the standings do not show through the curtain.
 */
export function Board({
  categories,
  live,
  held,
}: {
  categories: ResultCategory[];
  live: boolean;
  held: string | null;
}) {
  // Every column's head is as tall as the tallest, so the podium rows line up across the whole board.
  const n = categories.length;
  const headH = Math.max(0, ...categories.map((c) => planColumn(c, n).head.height));
  const plans = categories.map((c) => planColumn(c, n, headH));
  return (
    <div className="flex" style={{ height: COL_H, gap: 32 }}>
      {categories.map((c, i) => (
        <Column
          key={c.id}
          category={c}
          plan={plans[i]!}
          live={live}
          sealed={c.sealed || c.id === held}
        />
      ))}
    </div>
  );
}
