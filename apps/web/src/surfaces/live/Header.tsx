import type { ResultsFrame } from '@mc/shared';
import { Icon } from '../../design-system/Icon';
import { Logo } from '../../design-system/Logo';
import { A, E, withTime } from './parts';
import { clockTime, formatCountdown } from './model';
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
    <span lang="ar" className={`text-[40px] leading-[1.2] ${strong ? 'font-bold' : ''}`}>
      {ar}
    </span>
    <bdi lang="en" className="text-[40px] leading-[1.2] text-white/72">
      {en}
    </bdi>
  </span>
);

/** Logo, status, votes so far, and the countdown. One line, one glance. */
export function Header({
  frame,
  serverNow,
  offline,
}: {
  frame: ResultsFrame;
  serverNow: number;
  /** The stream has been down long enough to tell the room (the last frame stays on screen). */
  offline: boolean;
}) {
  const pill = pillFor(frame);
  const target = offline
    ? null // a countdown beside an "offline" notice would only crowd the line; the stage keeps the last numbers
    : frame.voting.state === 'OPEN' && frame.voting.closesAt
      ? { ms: Date.parse(frame.voting.closesAt) - serverNow, ar: A.closesIn, en: E.closesIn }
      : frame.voting.state === 'NOT_YET_OPEN' && frame.voting.opensAt
        ? { ms: Date.parse(frame.voting.opensAt) - serverNow, ar: A.opensIn, en: E.opensIn }
        : null;

  return (
    <header className="flex h-[80px] shrink-0 items-center justify-between">
      <div className="flex items-center gap-[40px]">
        <Logo variant="white" className="h-[64px] w-auto" alt="" />
        <span
          className={`inline-flex h-[64px] items-center gap-[16px] rounded-full px-[30px] ${
            pill.key === 'sealed' || pill.key === 'results'
              ? 'bg-white/[0.16] text-white'
              : 'bg-white/10 text-white'
          }`}
        >
          {pill.key === 'live' ? (
            <span
              className="relative flex size-[22px] items-center justify-center"
              aria-hidden="true"
            >
              {!offline && <span className="tv-pulse absolute inset-0 rounded-full bg-turquoise" />}
              <span
                className={`relative size-[14px] rounded-full ${offline ? 'bg-white/40' : 'bg-turquoise'}`}
              />
            </span>
          ) : pill.key === 'sealed' ? (
            <Icon name="lock" size={28} strokeWidth={2.4} />
          ) : null}
          <span lang="ar" className="text-[40px] font-bold leading-[1.2]">
            {pill.ar}
          </span>
          <bdi lang="en" className="text-[40px] leading-[1.2] text-white/72">
            {pill.en}
          </bdi>
        </span>
        {offline && (
          <span
            role="status"
            className="inline-flex h-[64px] items-center gap-[16px] rounded-full bg-white px-[30px] text-navy"
          >
            <Icon name="signal" size={30} strokeWidth={2.4} />
            <span lang="ar" className="text-[40px] font-bold leading-[1.2]">
              {A.reconnecting}
            </span>
            <bdi lang="en" className="text-[40px] leading-[1.2] text-navy/75">
              {E.reconnecting}
            </bdi>
          </span>
        )}
        {!offline && frame.mode === 'FROZEN' && frame.frozenAt && (
          <span lang="ar" className="text-[40px] font-bold leading-[1.2] text-white">
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
