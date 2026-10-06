import { describe, expect, it } from 'vitest';
import type { CatalogCategory, Vote } from '@mc/shared';
import { votedCount } from './store';

const cat = (id: string) => ({ id }) as CatalogCategory;
const vote = (categoryId: string) => ({ categoryId }) as Vote;

describe('votedCount', () => {
  it('counts only votes in categories that are still in the catalog', () => {
    // The visitor voted in X, an organiser then archived X: 3 votes on record, but only 2 of 3 active categories.
    const active = [cat('a'), cat('b'), cat('c')];
    const votes = { x: vote('x'), a: vote('a'), b: vote('b') };
    expect(votedCount(active, votes)).toBe(2);
    expect(votedCount(active, { ...votes, c: vote('c') })).toBe(3);
    expect(votedCount([], votes)).toBe(0);
  });
});
