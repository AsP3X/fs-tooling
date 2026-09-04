import { describe, expect, it } from 'vitest';
import { civilDate, dateKey, formatStart, parseStartDate, parseStartInput, parseTicketDate, prettyStart } from './dates';

describe('civilDate', () => {
  it('clamps overflow days to the last day of the month', () => {
    const d = civilDate(2026, 2, 31);
    expect(d).not.toBeNull();
    expect(dateKey(d)).toBe('2026-02-28');
  });

  it('rejects invalid months', () => {
    expect(civilDate(2026, 0, 1)).toBeNull();
    expect(civilDate(2026, 13, 1)).toBeNull();
  });
});

describe('parseTicketDate', () => {
  it('parses Freshservice "14 Sep, 2026, 10:00" titles', () => {
    const d = parseTicketDate('14 Sep, 2026, 10:00');
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(14);
    expect(d?.getHours()).toBe(10);
  });

  it('parses day-first numeric dates', () => {
    const d = parseTicketDate('14-09-2026 08:30');
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(14);
    expect(d?.getHours()).toBe(8);
    expect(d?.getMinutes()).toBe(30);
  });
});

describe('parseStartDate', () => {
  it('reads Start DD-MM-YYYY from an onboarding title', () => {
    const d = parseStartDate('Employee Onboarding Request - Alex - Start 14-09-2026 (Internal employee)');
    expect(dateKey(d)).toBe('2026-09-14');
  });

  it('accepts Starting and slashes', () => {
    expect(dateKey(parseStartDate('Starting: 1/2/26'))).toBe('2026-02-01');
  });

  it('ignores titles without a Start fragment', () => {
    expect(parseStartDate('Cannot print from 14-09-2026')).toBeNull();
  });
});

describe('parseStartInput', () => {
  it('normalizes typed dates to YYYY-MM-DD keys', () => {
    expect(parseStartInput('14-09-2026')).toBe('2026-09-14');
    expect(parseStartInput('2026-09-14')).toBe('2026-09-14');
    expect(parseStartInput('14 Sep 2026')).toBe('2026-09-14');
    expect(parseStartInput('Start 14-09-2026')).toBe('2026-09-14');
  });
});

describe('formatStart / prettyStart', () => {
  it('formats storage keys as DD-MM-YYYY', () => {
    expect(formatStart('2026-09-14')).toBe('14-09-2026');
  });

  it('pretty-prints a Date', () => {
    expect(prettyStart(civilDate(2026, 9, 14))).toBe('14 Sep 2026');
  });
});
