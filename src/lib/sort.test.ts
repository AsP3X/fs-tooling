import { describe, expect, it } from 'vitest';
import { compareItems } from './sort';
import type { Sortable } from './types';

function row(partial: Partial<Sortable> & { ord: number }): Sortable {
  return {
    start: null,
    created: null,
    status: '',
    initiator: '',
    progress: { pct: null },
    ...partial,
  };
}

describe('compareItems', () => {
  it('default order uses original row index', () => {
    const a = row({ ord: 2 });
    const b = row({ ord: 1 });
    expect(compareItems(a, b, 'default', 1)).toBeGreaterThan(0);
  });

  it('sorts dates ascending and descending', () => {
    const a = row({ ord: 0, created: new Date(2026, 0, 1) });
    const b = row({ ord: 1, created: new Date(2026, 0, 2) });
    expect(compareItems(a, b, 'created', 1)).toBeLessThan(0);
    expect(compareItems(a, b, 'created', -1)).toBeGreaterThan(0);
  });

  it('sends null values last in both directions', () => {
    const missing = row({ ord: 0, start: null });
    const present = row({ ord: 1, start: new Date(2026, 0, 1) });
    expect(compareItems(missing, present, 'start', 1)).toBeGreaterThan(0);
    expect(compareItems(missing, present, 'start', -1)).toBeGreaterThan(0);
  });
});
