import { describe, expect, it } from 'vitest';
import { bucketize, summarize } from './stats';
import { BUCKETS } from './constants';

describe('summarize', () => {
  it('returns empty stats for no values', () => {
    expect(summarize([null, undefined])).toEqual({ n: 0, avg: null, med: null, p90: null });
  });

  it('computes avg, median, and p90', () => {
    const s = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.n).toBe(10);
    expect(s.avg).toBe(5.5);
    expect(s.med).toBe(5);
    expect(s.p90).toBe(9);
  });
});

describe('bucketize', () => {
  it('counts idle buckets', () => {
    const counts = bucketize([0.5, 2, 5, 10, 20], BUCKETS);
    expect(counts.map((b) => b.n)).toEqual([1, 1, 1, 1, 1]);
  });
});
