import type { VotingState } from '@mc/shared';
import type { Settings } from '../settings/repository.js';

export type VotingWindow = Pick<Settings, 'votingStatus' | 'votingOpensAt' | 'votingClosesAt'>;

/**
 * The single definition of "is voting open?" (F9). OPEN / CLOSED are manual organiser overrides and win over the
 * schedule. SCHEDULED opens at `votingOpensAt` and closes at `votingClosesAt`; with no opening time set it stays
 * closed — an unconfigured system fails closed rather than accepting votes by accident.
 * Evaluated with the server clock only.
 */
export function votingState(w: VotingWindow, now: Date = new Date()): VotingState {
  if (w.votingStatus === 'OPEN') return 'OPEN';
  if (w.votingStatus === 'CLOSED') return 'CLOSED';
  if (!w.votingOpensAt || now < w.votingOpensAt) return 'NOT_YET_OPEN';
  if (w.votingClosesAt && now >= w.votingClosesAt) return 'CLOSED';
  return 'OPEN';
}
