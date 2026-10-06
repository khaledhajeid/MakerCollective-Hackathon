import type { CatalogCategory, CatalogExhibitor } from '@mc/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../design-system/Button';
import { Icon } from '../../../design-system/Icon';
import { MotifTile } from '../../../design-system/Motifs';
import { Sheet } from '../../../design-system/Sheet';
import { useI18n } from '../../../i18n';
import { ApiError } from '../../../lib/api';
import { haptic } from '../../../lib/haptics';
import { errorMessage } from '../errors';
import { useVoter } from '../store';
import { Celebration } from './Celebration';

type Phase = 'confirm' | 'pending' | 'waiting' | 'done' | 'already';

interface Props {
  category: CatalogCategory;
  exhibitor: CatalogExhibitor | null;
  onClose: () => void;
  /** Called once the success moment has played. */
  onDone: () => void;
}

/**
 * ⑥ Confirm sheet. Votes are final, so the choice is restated with the photo before anything is sent. The UI says
 * "recorded" only after the server has said so; on a dropped connection it keeps the pending vote and retries
 * (safe: the API is idempotent per visitor + category + exhibitor).
 */
export function VoteSheet({ category, exhibitor, onClose, onDone }: Props) {
  const { d, pick, fmt } = useI18n();
  const { castVote } = useVoter();
  const [phase, setPhase] = useState<Phase>('confirm');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Keep the last exhibitor while the sheet animates out, so the content does not vanish mid-exit. A new choice
  // resets the sheet — derived during render (React's "adjust state when a prop changes" pattern), not in an effect.
  const [shown, setShown] = useState(exhibitor);
  if (exhibitor && exhibitor !== shown) {
    setShown(exhibitor);
    setPhase('confirm');
    setError(null);
  }

  /** `auto` = a background retry while offline: it must not flip the UI back to "pending" on every attempt. */
  const attempt = useCallback(
    async (auto: boolean) => {
      if (!exhibitor || inFlight.current) return;
      inFlight.current = true;
      if (!auto) {
        setPhase('pending');
        setError(null);
      }
      try {
        await castVote(category.id, exhibitor.id);
        haptic('success');
        setPhase('done');
      } catch (err) {
        if (err instanceof ApiError && err.isNetwork) setPhase('waiting');
        else if (err instanceof ApiError && err.code === 'ALREADY_VOTED') setPhase('already');
        else {
          haptic('warn');
          setPhase('confirm');
          setError(errorMessage(err, d, fmt));
        }
      } finally {
        inFlight.current = false;
      }
    },
    [castVote, category.id, d, exhibitor, fmt],
  );

  // Offline: retry the SAME request when the connection returns and every few seconds meanwhile. Not tied to the
  // `online` flag, so a reachable network with a down server cannot spin in a tight loop.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const retry = () => void attempt(true);
    window.addEventListener('online', retry);
    const t = window.setInterval(retry, 6000);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(t);
    };
  }, [phase, attempt]);

  // After the success moment, hand control back.
  useEffect(() => {
    if (phase !== 'done') return;
    const t = window.setTimeout(onDone, 1700);
    return () => window.clearTimeout(t);
  }, [phase, onDone]);

  const name = shown ? pick(shown.nameAr, shown.nameEn) : '';
  const categoryName = pick(category.nameAr, category.nameEn);
  const busy = phase === 'pending' || phase === 'waiting' || phase === 'done';

  return (
    <Sheet
      open={exhibitor !== null}
      onClose={onClose}
      labelledBy="vote-sheet-title"
      locked={busy}
      handleLabel={d.sheet.handle}
    >
      <div className="px-6 pb-2 text-center" aria-live="polite">
        {phase === 'done' ? (
          <div className="flex flex-col items-center pb-3 pt-1">
            <Celebration size={88} />
            <h2 id="vote-sheet-title" className="t-title -mt-4 text-navy">
              {d.sheet.doneTitle}
            </h2>
            <p className="t-body mt-2 text-muted">
              {fmt(d.sheet.doneBody, { category: categoryName })}
            </p>
          </div>
        ) : (
          <>
            {shown && (
              <div className="mx-auto mb-5 size-24 overflow-hidden rounded-[1.4rem] bg-royal-soft shadow-[var(--shadow-card)]">
                {shown.photoUrl ? (
                  <img
                    src={shown.photoUrl}
                    alt=""
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <MotifTile seed={shown.id} label={name} className="size-full" />
                )}
              </div>
            )}
            <h2 id="vote-sheet-title" className="t-title text-navy" dir="auto">
              {fmt(d.sheet.title, { name })}
            </h2>
            <p className="t-body mt-2 text-muted">
              {fmt(d.sheet.body, { category: categoryName })}
            </p>

            {phase === 'waiting' && (
              <p className="t-small mt-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-yellow-soft p-3 text-start font-bold text-ink">
                <Icon name="signal" size={20} className="mt-0.5 shrink-0" />
                {d.sheet.waiting}
              </p>
            )}
            {phase === 'already' && (
              <p
                className="t-small mt-4 rounded-[var(--radius-control)] bg-crimson-soft p-3 text-start font-bold text-crimson"
                role="alert"
              >
                {d.sheet.already}
              </p>
            )}
            {error && (
              <p
                className="t-small mt-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-crimson-soft p-3 text-start font-bold text-crimson"
                role="alert"
              >
                <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}

            <div className="mt-6 space-y-2.5">
              {phase !== 'already' && (
                <Button
                  loading={phase === 'pending' || phase === 'waiting'}
                  onClick={() => void attempt(false)}
                >
                  {phase === 'pending'
                    ? d.sheet.pending
                    : phase === 'waiting'
                      ? d.sheet.retry
                      : d.sheet.confirm}
                </Button>
              )}
              <Button variant="ghost" size="md" disabled={busy} onClick={onClose}>
                {phase === 'already' ? d.common.close : d.sheet.cancel}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
