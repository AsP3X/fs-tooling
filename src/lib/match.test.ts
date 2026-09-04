import { describe, expect, it } from 'vitest';
import { defaultPage } from './constants';
import { itemMatches } from './match';
import type { Matchable } from './types';

function item(partial: Partial<Matchable> = {}): Matchable {
  return {
    status: 'Open',
    idleDays: 10,
    startKey: '2026-09-14',
    startIn: 3,
    progress: { pct: 20 },
    ...partial,
  };
}

describe('itemMatches', () => {
  it('OR: marks when idle age matches even without tags', () => {
    const cfg = defaultPage({ days: 6, matchMode: 'or', statuses: [], startDates: [] });
    expect(itemMatches(item({ idleDays: 6 }), cfg)).toBe(true);
    expect(itemMatches(item({ idleDays: 5 }), cfg)).toBe(false);
  });

  it('OR: marks by status tag even when not stale', () => {
    const cfg = defaultPage({ days: 6, matchMode: 'or', statuses: ['Pending'] });
    expect(itemMatches(item({ idleDays: 1, status: 'Pending' }), cfg)).toBe(true);
  });

  it('AND: requires stale plus each selected filter', () => {
    const cfg = defaultPage({
      days: 6,
      matchMode: 'and',
      statuses: ['Open'],
      startDates: ['2026-09-14'],
    });
    expect(itemMatches(item({ idleDays: 10, status: 'Open', startKey: '2026-09-14' }), cfg)).toBe(true);
    expect(itemMatches(item({ idleDays: 1, status: 'Open', startKey: '2026-09-14' }), cfg)).toBe(false);
    expect(itemMatches(item({ idleDays: 10, status: 'Pending', startKey: '2026-09-14' }), cfg)).toBe(false);
    expect(itemMatches(item({ idleDays: 10, status: 'Open', startKey: '2026-01-01' }), cfg)).toBe(false);
  });

  it('AND: empty status/start tags do not require a match', () => {
    const cfg = defaultPage({ days: 6, matchMode: 'and', statuses: [], startDates: [] });
    expect(itemMatches(item({ idleDays: 6 }), cfg)).toBe(true);
  });

  it('OR: low progress can mark independently', () => {
    const cfg = defaultPage({ days: 30, matchMode: 'or', maxProgress: 40 });
    expect(itemMatches(item({ idleDays: 1, progress: { pct: 20 } }), cfg)).toBe(true);
    expect(itemMatches(item({ idleDays: 1, progress: { pct: 80 } }), cfg)).toBe(false);
  });

  it('startWithin uses startIn days (can be in the past)', () => {
    const cfg = defaultPage({ days: 30, matchMode: 'or', startWithin: 7 });
    expect(itemMatches(item({ idleDays: 1, startIn: 3 }), cfg)).toBe(true);
    expect(itemMatches(item({ idleDays: 1, startIn: -2 }), cfg)).toBe(true);
    expect(itemMatches(item({ idleDays: 1, startIn: 10 }), cfg)).toBe(false);
  });
});
