import type { ResultCategory } from '@mc/shared';
import { Icon } from '../../design-system/Icon';
import { A, Bi, Chevron, QrCode, voteUrl } from './parts';
import { DWELL_MS } from './model';
import { Ticker } from './Ticker';

/**
 * Every category at a glance: its current leader, a lock when sealed, dwell progress on the one on stage.
 *
 * Up to four categories each chip carries the category and its leader (56px, the exhibitor-name size). With more,
 * one row cannot hold that many names at a readable size, so only the category on stage keeps its text and the
 * others shrink to their colour marker plus the leader's vote count; the stage above carries the full story.
 */
export function Rail({
  categories,
  activeId,
  epoch,
  rotating,
  showQr,
}: {
  categories: ResultCategory[];
  activeId: string | null;
  epoch: number;
  rotating: boolean;
  showQr: boolean;
}) {
  const compact = categories.length > 4;
  return (
    <nav aria-label="Categories" className="flex h-[144px] shrink-0 items-stretch gap-[20px]">
      <ul className="m-0 flex min-w-0 flex-1 list-none items-stretch gap-[20px] p-0">
        {categories.map((c) => {
          const lead = c.exhibitors[0];
          const active = c.id === activeId;
          const collapsed = compact && !active;
          return (
            <li
              key={c.id}
              aria-label={collapsed ? c.nameAr : undefined}
              className={`relative flex min-w-0 overflow-hidden rounded-[28px] transition-colors duration-500 ${
                collapsed
                  ? 'max-w-[112px] flex-[1_1_64px] flex-col items-center justify-center gap-[6px]'
                  : 'flex-1 items-center gap-[20px] px-[26px]'
              } ${active ? 'bg-white/[0.16]' : 'bg-white/[0.07]'}`}
            >
              {active && rotating && (
                <span
                  key={epoch}
                  aria-hidden="true"
                  className="tv-dwell tv-dwell-chip absolute inset-0 bg-turquoise/20"
                  style={{ animationDuration: `${DWELL_MS}ms` }}
                />
              )}
              <Chevron color={c.color} size={collapsed ? 30 : 34} className="relative" />
              {collapsed ? (
                <span className="relative text-[40px] leading-[1.1]">
                  {c.sealed ? (
                    <Icon name="lock" size={30} strokeWidth={2.4} />
                  ) : lead ? (
                    <Ticker value={lead.votes} nudge={false} className="font-black text-yellow" />
                  ) : (
                    <span aria-hidden="true" className="text-white/60">
                      —
                    </span>
                  )}
                </span>
              ) : (
                <span className="relative min-w-0 flex-1">
                  <span
                    lang="ar"
                    className="block truncate py-[0.2em] -my-[0.2em] text-[40px] font-bold leading-[1.2]"
                  >
                    {c.nameAr}
                  </span>
                  <span className="mt-[2px] flex items-baseline gap-[16px] leading-[1.1]">
                    {c.sealed ? (
                      <span className="inline-flex items-center gap-[12px] text-[40px] text-white/72">
                        <Icon name="lock" size={32} strokeWidth={2.4} />
                        <span lang="ar">{A.sealed}</span>
                      </span>
                    ) : lead ? (
                      <>
                        <span
                          lang={lead.nameAr ? 'ar' : 'en'}
                          dir={lead.nameAr ? 'rtl' : 'ltr'}
                          className="min-w-0 truncate py-[0.2em] -my-[0.2em] text-[56px] font-bold"
                        >
                          {lead.nameAr ?? lead.nameEn}
                        </span>
                        <Ticker
                          value={lead.votes}
                          nudge={false}
                          className="shrink-0 text-[56px] font-black text-yellow"
                        />
                      </>
                    ) : (
                      <span aria-hidden="true" className="text-[40px] text-white/60">
                        —
                      </span>
                    )}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {showQr && (
        <div className="flex shrink-0 items-center gap-[24px] rounded-[28px] bg-white/[0.07] pe-[30px] ps-[12px]">
          <QrCode text={voteUrl()} size={120} />
          <Bi
            k="scanToVote"
            arClass="text-[40px] font-bold leading-[1.2] whitespace-nowrap"
            enClass="text-[40px] leading-[1.1] text-white/72 whitespace-nowrap"
          />
        </div>
      )}
    </nav>
  );
}
