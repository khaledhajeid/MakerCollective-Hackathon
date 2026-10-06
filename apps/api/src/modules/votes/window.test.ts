import { describe, expect, it } from 'vitest';
import { votingState } from './window.js';

const T = (iso: string) => new Date(iso);
const base = { votingStatus: 'SCHEDULED' as const, votingOpensAt: null, votingClosesAt: null };

describe('votingState (F9)', () => {
  it('manual OPEN / CLOSED override the schedule', () => {
    const w = { votingOpensAt: T('2030-01-01'), votingClosesAt: T('2030-01-02') };
    expect(votingState({ ...base, ...w, votingStatus: 'OPEN' })).toBe('OPEN');
    expect(
      votingState(
        { ...base, votingStatus: 'CLOSED', votingOpensAt: T('2000-01-01') },
        T('2026-01-01'),
      ),
    ).toBe('CLOSED');
  });

  it('SCHEDULED follows the window, closing exactly at votingClosesAt', () => {
    const w = {
      ...base,
      votingOpensAt: T('2026-10-07T09:00Z'),
      votingClosesAt: T('2026-10-07T17:00Z'),
    };
    expect(votingState(w, T('2026-10-07T08:59:59Z'))).toBe('NOT_YET_OPEN');
    expect(votingState(w, T('2026-10-07T09:00:00Z'))).toBe('OPEN');
    expect(votingState(w, T('2026-10-07T16:59:59Z'))).toBe('OPEN');
    expect(votingState(w, T('2026-10-07T17:00:00Z'))).toBe('CLOSED');
  });

  it('SCHEDULED with no closing time stays open once opened', () => {
    const w = { ...base, votingOpensAt: T('2026-10-07T09:00Z') };
    expect(votingState(w, T('2099-01-01'))).toBe('OPEN');
  });

  it('fails closed when SCHEDULED has no opening time (unconfigured system)', () => {
    expect(votingState(base)).toBe('NOT_YET_OPEN');
    expect(votingState({ ...base, votingClosesAt: T('2099-01-01') })).toBe('NOT_YET_OPEN');
  });
});
