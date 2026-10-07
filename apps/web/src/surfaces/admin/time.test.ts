import { describe, expect, it } from 'vitest';
import { fromAmman, toAmman } from './time';

describe('Jordan event time', () => {
  it('reads an instant as Amman wall-clock time (UTC+3 in October 2026)', () => {
    expect(toAmman('2026-10-08T07:00:00.000Z')).toBe('2026-10-08T10:00');
    expect(toAmman('2026-10-07T21:30:00.000Z')).toBe('2026-10-08T00:30');
    expect(toAmman(null)).toBe('');
  });
  it('turns what the organiser typed back into the same instant', () => {
    expect(fromAmman('2026-10-08T10:00')).toBe('2026-10-08T07:00:00.000Z');
    expect(fromAmman('2026-10-08T00:30')).toBe('2026-10-07T21:30:00.000Z');
  });
  it('round-trips, and rejects junk', () => {
    for (const iso of [
      '2026-10-08T07:00:00.000Z',
      '2026-01-15T12:45:00.000Z',
      '2026-07-01T20:59:00.000Z',
    ])
      expect(fromAmman(toAmman(iso))).toBe(iso);
    expect(fromAmman('')).toBeNull();
    expect(fromAmman('tomorrow')).toBeNull();
  });
});
