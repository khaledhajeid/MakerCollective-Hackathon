import { useMemo } from 'react';
import { Button } from '../../../design-system/Button';
import { Icon } from '../../../design-system/Icon';
import { ChevronTrail } from '../../../design-system/Motifs';
import { useI18n } from '../../../i18n';
import { navigate } from '../../../lib/nav';
import { BrandMark, Hero, LanguageToggle, Skeleton } from '../components/Chrome';
import { CategoryCard } from '../components/CategoryCard';
import { useVoter, votedCount } from '../store';

/** ④ Vote hub: how far along you are, and the next category to decide. */
export function Hub() {
  const { d, fmt } = useI18n();
  const { visitor, categories, votes, votesError, refreshVotes, signOut, refreshCatalog } =
    useVoter();
  const cats = useMemo(() => categories.data ?? [], [categories.data]);
  const done = useMemo(() => votedCount(cats, votes), [cats, votes]);
  const allDone = cats.length > 0 && done === cats.length;
  const firstName = (visitor?.name ?? '').trim().split(/\s+/)[0] ?? '';

  return (
    <div className="flex min-h-dvh flex-col pb-10">
      <Hero className="px-6 pb-12 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <BrandMark className="w-28" />
          <LanguageToggle onDark />
        </div>
        <p className="t-body mt-9 text-white/85" dir="auto">
          {fmt(d.hub.greeting, { name: firstName })}
        </p>
        <h1 className="t-title mt-1 max-w-[18ch]" tabIndex={-1} data-screen-title>
          {d.hub.title}
        </h1>
        {cats.length > 0 && (
          <div className="mt-6 flex items-center gap-4" role="status">
            <ChevronTrail total={cats.length} filled={done} onDark />
            <span className="t-label text-white/90">
              {fmt(d.hub.progress, { n: done, total: cats.length })}
            </span>
          </div>
        )}
      </Hero>

      <div className="relative -mt-5 space-y-3.5 px-5">
        {categories.status === 'loading' && (
          <>
            <Skeleton className="h-[7.25rem]" />
            <Skeleton className="h-[7.25rem]" />
            <Skeleton className="h-[7.25rem]" />
          </>
        )}
        {categories.status === 'error' && cats.length === 0 && (
          <div className="rounded-[var(--radius-card)] bg-surface p-6 text-center shadow-[var(--shadow-card)]">
            <p className="t-body text-muted">{d.errors.network}</p>
            <div className="mt-4">
              <Button variant="secondary" size="md" onClick={() => void refreshCatalog()}>
                <Icon name="refresh" size={18} />
                {d.common.tryAgain}
              </Button>
            </div>
          </div>
        )}
        {categories.status === 'ready' && cats.length === 0 && (
          <p className="t-body rounded-[var(--radius-card)] bg-surface p-6 text-center text-muted shadow-[var(--shadow-card)]">
            {d.hub.noCategories}
          </p>
        )}
        {votesError && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-[var(--radius-control)] bg-yellow-soft p-3.5"
          >
            <p className="t-small flex-1 font-bold text-ink">{d.hub.votesError}</p>
            <button
              type="button"
              onClick={() => void refreshVotes()}
              className="t-label min-h-12 rounded-lg px-3 text-royal underline decoration-2 underline-offset-4"
            >
              {d.common.tryAgain}
            </button>
          </div>
        )}
        {cats.map((c, i) => {
          const v = votes[c.id];
          return (
            <CategoryCard
              key={c.id}
              category={c}
              index={i}
              voted={!!v}
              picked={v ? c.exhibitors.find((e) => e.id === v.exhibitorId) : undefined}
              onOpen={() => navigate(`/vote/c/${c.id}`)}
            />
          );
        })}

        {allDone && (
          <div className="rounded-[var(--radius-card)] bg-navy p-5 text-white shadow-[var(--shadow-raised)]">
            <p className="t-heading">{d.hub.allDone}</p>
            <p className="t-small mt-1 text-white/80">{d.hub.allDoneBody}</p>
            <div className="mt-4">
              <Button variant="onDark" size="md" onClick={() => navigate('/vote/done')}>
                {d.hub.seeSummary}
              </Button>
            </div>
          </div>
        )}

        <div className="pt-3 text-center">
          <button
            type="button"
            onClick={() =>
              void signOut().then(() => navigate('/vote', { replace: true, dir: 'back' }))
            }
            className="t-small min-h-12 rounded-lg px-4 font-bold text-muted underline decoration-2 underline-offset-4"
          >
            {d.common.signOut}
          </button>
        </div>
      </div>
    </div>
  );
}
