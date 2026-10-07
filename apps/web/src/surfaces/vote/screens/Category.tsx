import type { CatalogExhibitor } from '@mc/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../../design-system/Icon';
import { useCountLabel, useI18n } from '../../../i18n';
import { normaliseSearch } from '../../../lib/color';
import { navigate } from '../../../lib/nav';
import { BackButton, LanguageToggle, Skeleton } from '../components/Chrome';
import { ExhibitorCard } from '../components/ExhibitorCard';
import { VoteSheet } from '../components/VoteSheet';
import { useVoter, votedCount } from '../store';

/** ⑤ Pick an exhibitor in one category (photo-led, instantly searchable). Tapping a card opens the confirm sheet. */
export function CategoryScreen({ id }: { id: string }) {
  const { d, pick, fmt } = useI18n();
  const countLabel = useCountLabel();
  const { categories, votes } = useVoter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CatalogExhibitor | null>(null);

  const category = categories.data?.find((c) => c.id === id);
  const myVote = votes[id];

  const list = useMemo(() => {
    if (!category) return [];
    const q = normaliseSearch(query);
    const all = category.exhibitors;
    const found = q
      ? all.filter((e) =>
          normaliseSearch(
            [e.nameAr, e.nameEn, e.projectAr, e.projectEn, e.booth].filter(Boolean).join(' '),
          ).includes(q),
        )
      : all;
    // The visitor's own pick floats to the top so it is the first thing they see.
    return [...found].sort(
      (a, b) => Number(b.id === myVote?.exhibitorId) - Number(a.id === myVote?.exhibitorId),
    );
  }, [category, query, myVote?.exhibitorId]);

  // A category that no longer exists (an admin removed it) sends the visitor back to the hub.
  const missing = categories.status === 'ready' && !category;
  useEffect(() => {
    if (missing) navigate('/vote', { replace: true });
  }, [missing]);

  const finish = useCallback(() => {
    setSelected(null);
    const total = categories.data?.length ?? 0;
    const doneNow = votedCount(categories.data ?? [], votes);
    // `votes` here already includes the vote just cast (store updates before the success moment ends).
    if (total > 0 && doneNow >= total) navigate('/vote/done', { replace: true, dir: 'forward' });
    else navigate('/vote', { replace: true, dir: 'back' });
  }, [categories.data, votes]);

  if (categories.status === 'loading' || (!category && categories.status !== 'ready')) {
    return (
      <div className="space-y-4 p-5">
        <Skeleton className="h-12" />
        <Skeleton className="aspect-[16/10]" />
        <Skeleton className="aspect-[16/10]" />
      </div>
    );
  }
  if (!category) return null; // the effect above sends the visitor back to the hub

  return (
    <div className="flex min-h-dvh flex-col pb-10">
      <header
        className="sticky top-0 bg-canvas px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
        style={{ zIndex: 'var(--z-sticky)' }}
      >
        <div className="flex items-center gap-3">
          <BackButton fallback="/vote" />
          <div className="min-w-0 flex-1">
            <h1 className="t-heading text-navy" tabIndex={-1} data-screen-title dir="auto">
              {pick(category.nameAr, category.nameEn)}
            </h1>
            <p className="t-small text-muted">{countLabel(category.exhibitors.length)}</p>
          </div>
          <LanguageToggle />
        </div>
        {category.exhibitors.length > 4 && (
          <div className="relative mt-3">
            <Icon
              name="search"
              size={20}
              className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={d.category.searchLabel}
              placeholder={d.category.searchPlaceholder}
              className="min-h-12 w-full rounded-full bg-surface ps-11 pe-11 text-base text-ink ring-[1.5px] ring-inset ring-line outline-none placeholder:text-muted focus:ring-[2.5px] focus:ring-purple [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label={d.category.clearSearch}
                onClick={() => setQuery('')}
                className="absolute end-0 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full text-muted"
              >
                <Icon name="close" size={18} />
              </button>
            )}
          </div>
        )}
      </header>

      <div className="space-y-6 px-5 pt-2">
        <p
          className={`t-small flex items-center gap-2 rounded-[var(--radius-control)] p-3 font-bold ${
            myVote ? 'bg-turquoise-soft text-navy' : 'bg-royal-soft text-navy'
          }`}
        >
          <Icon name={myVote ? 'check' : 'info'} size={18} className="shrink-0" />
          {myVote ? d.category.recorded : d.category.chooseHint}
        </p>

        {category.exhibitors.length === 0 && (
          <p className="t-body py-10 text-center text-muted">{d.category.empty}</p>
        )}
        {category.exhibitors.length > 0 && list.length === 0 && (
          <p className="t-body py-10 text-center text-muted" role="status">
            {fmt(d.category.noMatches, { q: query })}
          </p>
        )}
        {list.map((e) => (
          <ExhibitorCard
            key={e.id}
            exhibitor={e}
            picked={e.id === myVote?.exhibitorId}
            locked={!!myVote}
            onOpen={() => !myVote && setSelected(e)}
          />
        ))}
      </div>

      <VoteSheet
        category={category}
        exhibitor={selected}
        onClose={() => setSelected(null)}
        onDone={finish}
      />
    </div>
  );
}
