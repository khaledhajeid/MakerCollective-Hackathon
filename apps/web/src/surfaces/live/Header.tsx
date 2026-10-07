import type { ResultsFrame } from '@mc/shared';
import { Icon } from '../../design-system/Icon';
import { Logo } from '../../design-system/Logo';
import { A, E, withTime } from './parts';
import { clockTime, formatCountdown } from './model';
import { useNow } from './hooks';
import { Ticker } from './Ticker';

type Pill = { key: 'live' | 'closed' | 'soon' | 'sealed' | 'results'; ar: string; en: string };

function pillFor(f: ResultsFrame): Pill {
  if (f.mode === 'FROZEN' || f.mode === 'HIDDEN')
    return { key: 'sealed', ar: A.blindHour, en: E.blindHour };
  if (f.mode === 'REVEAL') return { key: 'results', ar: A.resultsTitle, en: E.resultsTitle };
  if (f.voting.state === 'CLOSED') return { key: 'closed', ar: A.votingClosed, en: E.votingClosed };
  if (f.voting.state === 'NOT_YET_OPEN') return { key: 'soon', ar: A.opensSoon, en: E.opensSoon };
  return { key: 'live', ar: A.live, en: E.live };
}

const Pair = ({ ar, en, strong = true }: { ar: string; en: string; strong?: boolean }) => (
  <span className="inline-flex items-baseline gap-[14px] whitespace-nowrap">
    <span lang="ar" className={`text-[40px] leading-[1.3] ${strong ? 'font-bold' : ''}`}>
      {ar}
    </span>
    <bdi lang="en" className="text-[40px] leading-[1.2] text-dim">
      {en}
    </bdi>
  </span>
);

/** Logo, status, votes so far, and the countdown. One line, one glance. */
export function Header({
  frame,
  clockOffset,
  offline,
}: {
  frame: ResultsFrame;
  /** serverTime − clientTime (ms), so the countdown follows the server and not the TV's own clock. */
  clockOffset: number;
  /** The stream has been down long enough to tell the room (the last frame stays on screen). */
  offline: boolean;
}) {
  // The only per-second clock on the screen lives here, so nothing else re-renders to update a countdown.
  const serverNow = useNow(1000) + clockOffset;
  const pill = pillFor(frame);
  const target = offline
    ? null // a countdown beside an "offline" notice would only crowd the line; the stage keeps the last numbers
    : frame.voting.state === 'OPEN' && frame.voting.closesAt
      ? { ms: Date.parse(frame.voting.closesAt) - serverNow, ar: A.closesIn, en: E.closesIn }
      : frame.voting.state === 'NOT_YET_OPEN' && frame.voting.opensAt
        ? { ms: Date.parse(frame.voting.opensAt) - serverNow, ar: A.opensIn, en: E.opensIn }
        : null;

  return (
    <header className="flex h-[88px] shrink-0 items-center justify-between text-white">
      <div className="flex items-center gap-[40px]">
        <Logo variant="white" className="h-[72px] w-auto" alt="" />
        {/* Offline, the "Live" pill would claim what is no longer true: the reconnecting notice replaces it. */}
        {!(offline && pill.key === 'live') && (
          <span className="inline-flex h-[68px] items-center gap-[16px] rounded-full bg-white/10 px-[32px] text-white ring-1 ring-white/15">
            {pill.key === 'live' ? (
              <span
                className="relative flex size-[22px] items-center justify-center"
                aria-hidden="true"
              >
                {!offline && (
                  <span className="tv-pulse absolute inset-0 rounded-full bg-turquoise" />
                )}
                <span
                  className={`relative size-[14px] rounded-full ${offline ? 'bg-white/40' : 'bg-turquoise'}`}
                />
              </span>
            ) : pill.key === 'sealed' ? (
              <Icon name="lock" size={28} strokeWidth={2.4} />
            ) : null}
            <span lang="ar" className="text-[40px] font-bold leading-[1.3]">
              {pill.ar}
            </span>
            <bdi lang="en" className="text-[40px] leading-[1.2] text-white/80">
              {pill.en}
            </bdi>
          </span>
        )}
        {offline && (
          <span
            role="status"
            className="inline-flex h-[68px] items-center gap-[16px] rounded-full bg-white px-[30px] text-navy"
          >
            <Icon name="signal" size={30} strokeWidth={2.4} />
            <span lang="ar" className="text-[40px] font-bold leading-[1.3]">
              {A.reconnecting}
            </span>
            <bdi lang="en" className="text-[40px] leading-[1.2] text-navy-dim">
              {E.reconnecting}
            </bdi>
          </span>
        )}
        {!offline && frame.mode === 'FROZEN' && frame.frozenAt && (
          <span lang="ar" className="text-[40px] font-bold leading-[1.3]">
            {withTime(A.sealedAt, clockTime(frame.frozenAt))}
          </span>
        )}
      </div>

      <div className="flex items-center gap-[56px]">
        {frame.totalVotes !== null && (
          <span className="inline-flex items-baseline gap-[14px]">
            <Ticker
              value={frame.totalVotes}
              nudge={frame.mode === 'LIVE'}
              className="text-[52px] font-black leading-none"
            />
            <Pair ar={A.votes} en={E.votes} strong={false} />
          </span>
        )}
        {target && (
          <span className="inline-flex items-baseline gap-[18px]">
            <Pair ar={target.ar} en={target.en} strong={false} />
            <span className="num text-[52px] font-black leading-none">
              {formatCountdown(target.ms)}
            </span>
          </span>
        )}
      </div>
    </header>
  );
}
