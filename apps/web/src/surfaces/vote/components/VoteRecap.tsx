import { Icon } from '../../../design-system/Icon';
import { useI18n } from '../../../i18n';
import { useVoter } from '../store';

/** "Category → the project you chose", read from the catalog + the visitor's own votes. */
export function VoteRecap({ onDark = false }: { onDark?: boolean }) {
  const { pick } = useI18n();
  const { categories, votes } = useVoter();
  const rows = (categories.data ?? []).filter((c) => votes[c.id]);
  return (
    <ul className="space-y-2.5">
      {rows.map((c) => {
        const ex = c.exhibitors.find((e) => e.id === votes[c.id]!.exhibitorId);
        return (
          <li
            key={c.id}
            className={`flex items-center gap-3 rounded-[var(--radius-control)] p-3.5 ${
              onDark ? 'bg-white/10 ring-1 ring-white/20' : 'bg-surface shadow-[var(--shadow-card)]'
            }`}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-turquoise text-navy">
              <Icon name="check" size={18} strokeWidth={3} />
            </span>
            <span className="min-w-0">
              <span className={`t-small block ${onDark ? 'text-white/75' : 'text-muted'}`}>
                {pick(c.nameAr, c.nameEn)}
              </span>
              <span className="t-heading block break-words" dir="auto">
                {ex ? pick(ex.nameAr, ex.nameEn) : '—'}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
