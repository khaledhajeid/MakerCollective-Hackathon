import type { CatalogExhibitor } from '@mc/shared';
import { m } from 'motion/react';
import { useState } from 'react';
import { Icon } from '../../../design-system/Icon';
import { MotifTile } from '../../../design-system/Motifs';
import { spring } from '../../../design-system/motion';
import { useI18n } from '../../../i18n';
import { haptic } from '../../../lib/haptics';

interface Props {
  exhibitor: CatalogExhibitor;
  /** This is the visitor's recorded vote in the category. */
  picked: boolean;
  /** The category already has a vote, so the others are final-locked. */
  locked: boolean;
  onOpen: () => void;
}

/** Photo-led card (no chrome): the photo is the affordance, the whole block is the tap target. */
export function ExhibitorCard({ exhibitor, picked, locked, onOpen }: Props) {
  const { d, pick, fmt } = useI18n();
  const [broken, setBroken] = useState(false);
  const name = pick(exhibitor.nameAr, exhibitor.nameEn);
  const project = pick(exhibitor.projectAr, exhibitor.projectEn);
  const inactive = locked && !picked;
  return (
    <m.button
      type="button"
      disabled={inactive}
      aria-pressed={picked || undefined}
      onClick={() => {
        haptic('tap');
        onOpen();
      }}
      whileTap={inactive || picked ? undefined : { scale: 0.975 }}
      transition={spring.press}
      className={`block w-full text-start transition-opacity duration-300 ${inactive ? 'opacity-55' : ''}`}
    >
      <span
        className={`relative block aspect-[16/10] overflow-hidden rounded-[1.4rem] bg-royal-soft ${
          picked ? 'ring-[3px] ring-turquoise ring-offset-2 ring-offset-canvas' : ''
        }`}
      >
        {exhibitor.photoUrl && !broken ? (
          <img
            src={exhibitor.photoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={640}
            height={400}
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
        ) : (
          <MotifTile seed={exhibitor.id} label={name} className="size-full" />
        )}
        {picked && (
          <span className="t-label absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-turquoise px-3 py-1.5 text-navy shadow-[var(--shadow-card)]">
            <Icon name="check" size={16} strokeWidth={3.2} />
            {d.category.yourPick}
          </span>
        )}
        {exhibitor.booth && (
          <span className="t-small absolute bottom-3 end-3 rounded-full bg-white/95 px-3 py-1 font-bold text-navy shadow-[var(--shadow-card)]">
            {fmt(d.category.booth, { booth: exhibitor.booth })}
          </span>
        )}
      </span>
      <span className="mt-3 block px-1">
        <span className="t-heading block text-navy" dir="auto">
          {name}
        </span>
        {project && (
          <span className="t-small mt-0.5 line-clamp-2 block text-muted" dir="auto">
            {project}
          </span>
        )}
      </span>
    </m.button>
  );
}
