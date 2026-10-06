import type { CatalogCategory, CatalogExhibitor } from '@mc/shared';
import { m } from 'motion/react';
import { Icon } from '../../../design-system/Icon';
import { spring } from '../../../design-system/motion';
import { useI18n } from '../../../i18n';
import { onColor } from '../../../lib/color';
import { haptic } from '../../../lib/haptics';

const MOTIFS = [
  // gear ring · circle · triangle · chevrons — the brand vocabulary, cycled by category order
  <circle
    key="g"
    cx="12"
    cy="12"
    r="7.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="4"
    strokeDasharray="3.4 2.6"
  />,
  <circle key="c" cx="12" cy="12" r="8" fill="currentColor" />,
  <path key="t" d="M20 12 5 3.5v17Z" fill="currentColor" />,
  <g key="v" fill="currentColor">
    <path d="M12 12 4 7v10Z" />
    <path d="M21 12 13 7v10Z" />
  </g>,
];

interface Props {
  category: CatalogCategory;
  index: number;
  /** The visitor already voted in this category. */
  voted: boolean;
  /** The exhibitor they chose, if it is still listed (an archived one is not). */
  picked: CatalogExhibitor | undefined;
  onOpen: () => void;
}

/** One category on the hub: pending (tap to choose) or voted (shows your pick). */
export function CategoryCard({ category, index, voted, picked, onOpen }: Props) {
  const { d, pick } = useI18n();
  const name = pick(category.nameAr, category.nameEn);
  const description = pick(category.descriptionAr, category.descriptionEn);
  const fg = onColor(category.color);
  return (
    <m.button
      type="button"
      onClick={() => {
        haptic('tap');
        onOpen();
      }}
      whileTap={{ scale: 0.975 }}
      transition={spring.press}
      className={`flex w-full items-center gap-4 rounded-[var(--radius-card)] p-4 text-start transition-colors duration-300 ${
        voted
          ? 'bg-turquoise-soft shadow-[0_0_0_1.5px_var(--color-turquoise),0_10px_26px_-10px_rgb(0_0_123/0.18)]'
          : 'bg-surface shadow-[var(--shadow-card)]'
      }`}
    >
      <span
        className="relative grid size-[3.75rem] shrink-0 place-items-center rounded-[1.1rem]"
        style={{ background: category.color, color: fg }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="size-7">
          {MOTIFS[index % MOTIFS.length]}
        </svg>
        {voted && (
          <span className="absolute -end-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-navy text-white ring-2 ring-turquoise-soft">
            <Icon name="check" size={14} strokeWidth={3.4} />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="t-heading block text-navy" dir="auto">
          {name}
        </span>
        {voted ? (
          <span className="t-small mt-0.5 block text-ink">
            <span className="font-bold">{d.hub.yourVote}: </span>
            <span dir="auto">{picked ? pick(picked.nameAr, picked.nameEn) : '—'}</span>
          </span>
        ) : (
          <>
            {description && (
              <span className="t-small mt-0.5 line-clamp-2 block text-muted" dir="auto">
                {description}
              </span>
            )}
            <span className="t-label mt-1.5 block text-purple">{d.hub.tapToChoose}</span>
          </>
        )}
      </span>
      <Icon name="forward" flip className={voted ? 'text-navy' : 'text-[#8b8bab]'} />
    </m.button>
  );
}
