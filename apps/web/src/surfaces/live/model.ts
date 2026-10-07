import type { ResultCategory, ResultsFrame } from '@mc/shared';

/** How long one category holds the stage before the next one takes over. */
export const DWELL_MS = 14_000;
/** The "reconnecting" chip waits this long, so a blip on the network never flashes at the room. */
export const OFFLINE_CHIP_MS = 5_000;
/** Heartbeats arrive every 5 s. Silence this long means the link is down even though the browser raised no error. */
export const QUIET_MS = 12_000;
/** Silence this long and the TV opens a fresh stream (a hung proxy or a pulled cable never closes the old one). */
export const STALE_MS = 25_000;
/** Winner ceremony length; its stages are timed in live.css. */
export const CEREMONY_MS = 15_000;

export type Screen = 'sealed' | 'waiting' | 'stage';

/** Categories whose standings the server has released. Sealed ones never reach the stage. */
export const stageCategories = (f: ResultsFrame): ResultCategory[] =>
  f.categories.filter((c) => !c.sealed);

/**
 * What the room sees. The server already decided what is released; this only picks the composition:
 * nothing released → sealed screen, an event with no votes → waiting screen, otherwise the stage.
 */
export function screenFor(f: ResultsFrame): Screen {
  if (f.mode === 'HIDDEN') return 'sealed';
  if (stageCategories(f).length === 0) return f.categories.length === 0 ? 'waiting' : 'sealed';
  if (f.mode === 'LIVE' && (f.totalVotes ?? 0) === 0) return 'waiting';
  return 'stage';
}

/** The category after `current` in rotation order (wraps; falls back to the first when `current` is gone). */
export function nextCategoryId(ids: readonly string[], current: string | null): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  return ids[(at + 1) % ids.length] ?? null;
}

/** `HH:MM:SS` for a countdown; never negative, hours may exceed 24. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
}

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Amman',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
/** `14:05` in event time, Western digits (the TV mixes Arabic and English text; numerals stay one style). */
export const clockTime = (iso: string): string => CLOCK.format(new Date(iso));

/** Bar length as a 0..1 share of the leader, never NaN. */
export const barRatio = (votes: number, max: number): number =>
  max <= 0 ? 0 : Math.min(1, Math.max(0, votes / max));

/**
 * A reveal that happened WHILE this TV was watching. `seen` is the reveal count this connection started with
 * (or last played), so a reload or reconnect never replays an old ceremony.
 */
export function newReveal(
  seen: number | null,
  f: ResultsFrame,
): { categoryId: string; seq: number } | null {
  if (seen === null || f.mode !== 'REVEAL' || !f.spotlight) return null;
  return f.spotlight.seq > seen ? f.spotlight : null;
}

/** The reveal count to remember after a frame: 0 outside REVEAL so a later reveal round starts fresh. */
export const revealBaseline = (f: ResultsFrame): number =>
  f.mode === 'REVEAL' ? (f.spotlight?.seq ?? 0) : 0;

/** Co-winners (everyone sharing rank 1) and the next places (ranks 2 and 3, skipping tied winners). */
export function podiumOf(c: ResultCategory) {
  const winners = c.exhibitors.filter((e) => e.rank === 1);
  const runnersUp = c.exhibitors.filter((e) => e.rank > 1 && e.rank <= 3);
  return { winners, runnersUp };
}
