import { describe, expect, it } from 'vitest';
import { defaultPage } from './constants';
import {
  asColor,
  blankFilter,
  duplicateFilter,
  firstMatchingFilter,
  forkFromBuiltin,
  mergeFilterList,
  moveFilter,
  restoreFromSource,
  ruleMatches,
} from './filters';
import type { FilterRule, Matchable } from './types';

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

function rule(partial: Partial<FilterRule> & Pick<FilterRule, 'id' | 'name'>): FilterRule {
  return {
    builtin: false,
    enabled: true,
    color: '#e65100',
    matchMode: 'or',
    criteria: {},
    ...partial,
  };
}

describe('ruleMatches', () => {
  it('OR: idle or status', () => {
    const r = rule({ id: 'a', name: 'A', criteria: { idleDays: 6, statuses: ['Pending'] } });
    expect(ruleMatches(item({ idleDays: 6, status: 'Open' }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 1, status: 'Pending' }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 1, status: 'Open' }), r, 'tickets')).toBe(false);
  });

  it('skips empty dimensions so a status-only rule does not require idle', () => {
    const r = rule({ id: 'a', name: 'A', matchMode: 'and', criteria: { statuses: ['Open'] } });
    expect(ruleMatches(item({ idleDays: 0, status: 'Open' }), r, 'tickets')).toBe(true);
  });
});

describe('firstMatchingFilter', () => {
  it('applies enabled rules in list order and returns that color', () => {
    const page = defaultPage({
      filters: [
        rule({ id: 'first', name: 'Idle', color: '#e65100', criteria: { idleDays: 6 } }),
        rule({ id: 'second', name: 'Open', color: '#1565c0', criteria: { statuses: ['Open'] } }),
      ],
    });
    const hit = firstMatchingFilter(item({ idleDays: 10, status: 'Open' }), page, 'tickets');
    expect(hit?.id).toBe('first');
    expect(hit?.color).toBe('#e65100');
  });

  it('skips disabled rules so a later color can win', () => {
    const page = defaultPage({
      filters: [
        rule({ id: 'first', name: 'Idle', enabled: false, color: '#e65100', criteria: { idleDays: 6 } }),
        rule({ id: 'second', name: 'Open', color: '#1565c0', criteria: { statuses: ['Open'] } }),
      ],
    });
    expect(firstMatchingFilter(item({ idleDays: 10, status: 'Open' }), page, 'tickets')?.id).toBe('second');
  });
});

describe('mergeFilterList builtins', () => {
  it('seeds ticket builtins and enables Idle 6d by default', () => {
    const list = mergeFilterList(defaultPage(), 'tickets');
    expect(list.some((r) => r.id === 'idle-6' && r.enabled && r.builtin)).toBe(true);
    expect(list.filter((r) => r.builtin).length).toBeGreaterThan(1);
  });

  it('keeps user order, enabled, and color on builtins', () => {
    const stored = defaultPage({
      filters: [
        rule({ id: 'w3p', name: '3rd party', builtin: true, enabled: true, color: '#111111', criteria: { idleDays: 99 } }),
      ],
    });
    const list = mergeFilterList(stored, 'tickets');
    const w3p = list.find((r) => r.id === 'w3p');
    expect(w3p?.enabled).toBe(true);
    expect(w3p?.color).toBe('#111111');
    expect(w3p?.criteria.idleDays).toBe(3);
    expect(list[0].id).toBe('w3p');
    expect(list.some((r) => r.id === 'idle-6')).toBe(true);
  });
});

describe('moveFilter', () => {
  it('swaps a rule one step', () => {
    const list = [
      rule({ id: 'a', name: 'A' }),
      rule({ id: 'b', name: 'B' }),
      rule({ id: 'c', name: 'C' }),
    ];
    expect(moveFilter(list, 'b', -1).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(moveFilter(list, 'a', -1)).toBe(list);
  });
});

describe('forkFromBuiltin', () => {
  it('creates a custom copy that restore can turn back into the default', () => {
    const idle = mergeFilterList(defaultPage(), 'tickets').find((r) => r.id === 'idle-6');
    if (!idle) throw new Error('missing idle-6');
    const fork = forkFromBuiltin({ ...idle, criteria: { idleDays: 12 } });
    expect(fork.builtin).toBe(false);
    expect(fork.sourceId).toBe('idle-6');
    expect(fork.id).not.toBe('idle-6');
    expect(fork.criteria.idleDays).toBe(12);
    const restored = restoreFromSource(fork, 'tickets');
    expect(restored?.id).toBe('idle-6');
    expect(restored?.builtin).toBe(true);
    expect(restored?.criteria.idleDays).toBe(6);
    expect(restored?.enabled).toBe(fork.enabled);
  });
});

describe('mergeFilterList', () => {
  it('does not re-insert a default that already has a custom fork', () => {
    const fork = forkFromBuiltin({
      id: 'idle-6',
      name: 'Idle 6d',
      builtin: true,
      enabled: true,
      color: '#e65100',
      matchMode: 'or',
      criteria: { idleDays: 12 },
    });
    const list = mergeFilterList(defaultPage({ filters: [fork] }), 'tickets');
    expect(list.some((r) => r.id === 'idle-6')).toBe(false);
    expect(list.some((r) => r.sourceId === 'idle-6' && r.criteria.idleDays === 12)).toBe(true);
  });
});

describe('duplicateFilter', () => {
  it('copies a builtin into a custom rule', () => {
    const copy = duplicateFilter(rule({ id: 'idle-6', name: 'Idle 6d', builtin: true, criteria: { idleDays: 6 } }));
    expect(copy.builtin).toBe(false);
    expect(copy.id).not.toBe('idle-6');
    expect(copy.criteria.idleDays).toBe(6);
  });
});

describe('asColor', () => {
  it('expands 3-digit hex and rejects junk', () => {
    expect(asColor('#0a0', '#e65100')).toBe('#00aa00');
    expect(asColor('#1565c0', '#e65100')).toBe('#1565c0');
    expect(asColor('red', '#e65100')).toBe('#e65100');
  });
});

describe('blankFilter', () => {
  it('starts enabled with the page default idle window', () => {
    expect(blankFilter('tickets').criteria.idleDays).toBe(6);
    expect(blankFilter('journeys').criteria.idleDays).toBe(7);
    expect(blankFilter('tickets').enabled).toBe(true);
  });
});
