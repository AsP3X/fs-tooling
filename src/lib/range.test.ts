import { describe, expect, it } from 'vitest';
import {
  formatRangeLabel,
  inDateRange,
  normalizeRange,
  rangeActive,
  rangeApplyReady,
  rangeDateKey,
  rangeListingEnabled,
  selectRangeRows,
  shiftDateKey,
  validDateKey,
} from './range';

describe('validDateKey', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(validDateKey('2026-09-14')).toBe('2026-09-14');
    expect(validDateKey('14-09-2026')).toBeNull();
    expect(validDateKey('')).toBeNull();
  });
});

describe('normalizeRange', () => {
  it('swaps inverted bounds', () => {
    expect(normalizeRange('2026-09-20', '2026-09-10')).toEqual({
      startFrom: '2026-09-10',
      startTo: '2026-09-20',
    });
  });
});

describe('shiftDateKey', () => {
  it('rolls over months and years in UTC', () => {
    expect(shiftDateKey('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateKey('nope', 1)).toBeNull();
  });
});

describe('inDateRange', () => {
  it('is inactive when both bounds are empty', () => {
    expect(inDateRange(null, null, null)).toBe(true);
    expect(inDateRange('2026-01-01', null, null)).toBe(true);
  });

  it('rejects items with no date when a range is set', () => {
    expect(inDateRange(null, '2026-09-01', null)).toBe(false);
  });

  it('is inclusive on both ends', () => {
    expect(inDateRange('2026-09-10', '2026-09-10', '2026-09-20')).toBe(true);
    expect(inDateRange('2026-09-20', '2026-09-10', '2026-09-20')).toBe(true);
    expect(inDateRange('2026-09-09', '2026-09-10', '2026-09-20')).toBe(false);
    expect(inDateRange('2026-09-21', '2026-09-10', '2026-09-20')).toBe(false);
  });
});

describe('selectRangeRows', () => {
  const rows = [
    { startKey: '2026-09-14', updatedKey: '2026-08-01' },
    { startKey: null, updatedKey: '2026-09-14' },
    { startKey: '2026-01-01', updatedKey: '2026-09-14' },
  ];

  it('returns nothing when the range is off', () => {
    expect(selectRangeRows(rows, 'start', null, null)).toEqual([]);
  });

  it('uses start keys on journeys and updated keys on tickets', () => {
    expect(selectRangeRows(rows, 'start', '2026-09-01', '2026-09-30').map((r) => r.startKey)).toEqual(['2026-09-14']);
    expect(selectRangeRows(rows, 'updated', '2026-09-01', '2026-09-30')).toHaveLength(2);
  });
});

describe('rangeDateKey', () => {
  it('does not fall back across modes', () => {
    expect(rangeDateKey({ startKey: '2026-09-14', updatedKey: '2026-01-01' }, 'start')).toBe('2026-09-14');
    expect(rangeDateKey({ startKey: '2026-09-14', updatedKey: null }, 'updated')).toBeNull();
  });
});

describe('formatRangeLabel', () => {
  it('formats open and closed ranges', () => {
    expect(formatRangeLabel('2026-09-14', '2026-09-14')).toBe('14-09-2026');
    expect(formatRangeLabel('2026-09-01', '2026-09-14')).toBe('01-09-2026 – 14-09-2026');
    expect(formatRangeLabel('2026-09-01', null)).toBe('from 01-09-2026');
    expect(formatRangeLabel(null, '2026-09-14')).toBe('until 14-09-2026');
  });
});

describe('rangeActive', () => {
  it('is true when either bound is set', () => {
    expect(rangeActive('2026-09-01', null)).toBe(true);
    expect(rangeActive(null, null)).toBe(false);
  });
});

describe('rangeListingEnabled', () => {
  it('requires an API key', () => {
    expect(rangeListingEnabled(false)).toBe(false);
    expect(rangeListingEnabled(true)).toBe(true);
  });
});

describe('rangeApplyReady', () => {
  it('needs a key and at least one bound', () => {
    expect(rangeApplyReady(false, '2026-09-01', '2026-09-14')).toBe(false);
    expect(rangeApplyReady(true, null, null)).toBe(false);
    expect(rangeApplyReady(true, '2026-09-01', null)).toBe(true);
  });
});
