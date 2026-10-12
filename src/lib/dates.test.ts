import { describe, expect, it } from 'vitest';
import { ageDays, civilDate, dateKey, daysUntil, formatStart, parseStartDate, parseStartInput, parseTicketDate, prettyStart } from './dates';

describe('ageDays / daysUntil', () => {
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);

  it('returns null for missing dates', () => {
    expect(ageDays(null, now)).toBeNull();
    expect(daysUntil(null, now)).toBeNull();
  });

  it('is positive in the past for age and negative for until', () => {
    const past = new Date(now - 2 * 86400000);
    expect(ageDays(past, now)).toBeCloseTo(2, 5);
    expect(daysUntil(past, now)).toBeCloseTo(-2, 5);
  });
});

describe('civilDate', () => {
  it('rejects a day that does not exist in that month', () => {
    expect(civilDate(2026, 2, 31)).toBeNull();
    expect(civilDate(2026, 2, 28)).not.toBeNull();
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

  it('parses German month abbreviations and full names', () => {
    const d = parseTicketDate('14 Okt, 2026, 10:00');
    expect(d?.getMonth()).toBe(9);
    expect(d?.getDate()).toBe(14);
    expect(parseTicketDate('12 Juni 2026')?.getMonth()).toBe(5);
    expect(parseTicketDate('3 Juli 2026')?.getMonth()).toBe(6);
  });

  it('parses Swedish maj and mars', () => {
    expect(parseTicketDate('12 maj 2026')?.getMonth()).toBe(4);
    expect(parseTicketDate('2 mars 2026')?.getDate()).toBe(2);
    expect(parseTicketDate('2 mars 2026')?.getMonth()).toBe(2);
  });

  it('rejects an impossible numeric day instead of rolling into the next month', () => {
    expect(parseTicketDate('31-02-2026')).toBeNull();
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
