import { describe, expect, it } from 'vitest';
import { defaultPage } from './constants';
import { DEFAULT_PATTERNS } from './patterns';
import {
  asColor,
  blankFilter,
  CANONICAL_TICKET_FILTERS,
  duplicateFilter,
  firstMatchingFilter,
  forkFromBuiltin,
  mergeFilterList,
  moveFilter,
  passingCriteria,
  prefilledStatusPattern,
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
    invert: false,
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

  it('orders ticket defaults by importance and prefills status regex', () => {
    const list = mergeFilterList(defaultPage(), 'tickets');
    expect(list.filter((r) => r.builtin).map((r) => r.id)).toEqual([...CANONICAL_TICKET_FILTERS]);
    const open = list.find((r) => r.id === 'open-idle');
    const idle = list.find((r) => r.id === 'idle-6');
    const pending = list.find((r) => r.id === 'pending-3');
    const third = list.find((r) => r.id === 'w3p');
    expect(open?.criteria.statusPattern).toBe(DEFAULT_PATTERNS.statusOpen);
    expect(idle?.matchMode).toBe('and');
    expect(idle?.criteria.statusPattern).toBe(DEFAULT_PATTERNS.statusOpen);
    expect(pending?.criteria.statusPattern).toBe(DEFAULT_PATTERNS.statusPending);
    expect(third?.criteria.statusPattern).toBe(DEFAULT_PATTERNS.statusThirdParty);
    expect(prefilledStatusPattern(open!)).toBe(DEFAULT_PATTERNS.statusOpen);
    expect(prefilledStatusPattern(idle!)).toBe(DEFAULT_PATTERNS.statusOpen);
    const urgent = list.find((r) => r.id === 'urgent');
    const high = list.find((r) => r.id === 'high');
    const unassigned = list.find((r) => r.id === 'unassigned');
    const escalated = list.find((r) => r.id === 'escalated');
    const overdue = list.find((r) => r.id === 'overdue');
    expect(urgent?.criteria.priorityPattern).toBe(DEFAULT_PATTERNS.priorityUrgent);
    expect(high?.criteria.priorityPattern).toBe(DEFAULT_PATTERNS.priorityHigh);
    expect(unassigned?.criteria.unassignedPattern).toBe(DEFAULT_PATTERNS.unassigned);
    expect(escalated?.criteria.escalatedPattern).toBe(DEFAULT_PATTERNS.escalated);
    expect(overdue?.criteria.duePattern).toBe(DEFAULT_PATTERNS.overdue);
    expect(prefilledStatusPattern(urgent!)).toBe(DEFAULT_PATTERNS.priorityUrgent);
    expect(prefilledStatusPattern(unassigned!)).toBe(DEFAULT_PATTERNS.unassigned);
  });

  it('Idle 6d beats Open when both are enabled so stale Open is not swallowed', () => {
    const list = mergeFilterList(defaultPage(), 'tickets').map((r) => ({
      ...r,
      enabled: r.id === 'idle-6' || r.id === 'open-idle',
    }));
    const page = defaultPage({ filters: list });
    expect(firstMatchingFilter(item({ idleDays: 10, status: 'Open' }), page, 'tickets')?.id).toBe('idle-6');
    expect(firstMatchingFilter(item({ idleDays: 0, status: 'Open' }), page, 'tickets')?.id).toBe('open-idle');
  });

  it('migrates the previous canonical order so Idle 6d sits above Open', () => {
    const stored = defaultPage({
      filters: [
        'urgent', 'escalated', 'overdue', 'unassigned', 'high',
        'open-idle', 'w3p', 'pending-3', 'idle-6',
      ].map((id) => rule({ id, name: id, builtin: true, enabled: id === 'idle-6' })),
    });
    expect(mergeFilterList(stored, 'tickets').filter((r) => r.builtin).map((r) => r.id)).toEqual([...CANONICAL_TICKET_FILTERS]);
    expect(mergeFilterList(stored, 'tickets').map((r) => r.id).indexOf('idle-6'))
      .toBeLessThan(mergeFilterList(stored, 'tickets').map((r) => r.id).indexOf('open-idle'));
  });

  it('lets a more specific enabled filter win over Idle', () => {
    const list = mergeFilterList(defaultPage(), 'tickets').map((r) => ({
      ...r,
      enabled: r.id === 'idle-6' || r.id === 'urgent',
    }));
    const hit = firstMatchingFilter(
      item({ idleDays: 10, priority: 4, status: 'Open' }),
      defaultPage({ filters: list }),
      'tickets',
    );
    expect(hit?.id).toBe('urgent');
  });

  it('migrates the legacy default order to canonical importance', () => {
    const stored = defaultPage({
      filters: [
        'idle-6', 'open-idle', 'pending-3', 'w3p', 'overdue', 'unassigned', 'high', 'urgent', 'escalated',
      ].map((id) => rule({ id, name: id, builtin: true, enabled: id === 'idle-6' })),
    });
    expect(mergeFilterList(stored, 'tickets').filter((r) => r.builtin).map((r) => r.id)).toEqual([...CANONICAL_TICKET_FILTERS]);
  });

  it('does not move a custom filter when migrating would shuffle the list', () => {
    const stored = defaultPage({
      filters: [
        ...[
          'idle-6', 'open-idle', 'pending-3', 'w3p', 'overdue', 'unassigned', 'high', 'urgent', 'escalated',
        ].map((id) => rule({ id, name: id, builtin: true })),
        rule({ id: 'mine', name: 'Mine', criteria: { idleDays: 2 } }),
      ],
    });
    const list = mergeFilterList(stored, 'tickets');
    expect(list[list.length - 1]?.id).toBe('mine');
    expect(list[0].id).toBe('idle-6');
  });

  it('does not refill a cleared regex on a forked default', () => {
    const open = mergeFilterList(defaultPage(), 'tickets').find((r) => r.id === 'open-idle');
    if (!open) throw new Error('missing open-idle');
    const fork = forkFromBuiltin({ ...open, criteria: { ...open.criteria, statusPattern: null } });
    expect(prefilledStatusPattern(fork)).toBe('');
    expect(prefilledStatusPattern(open)).toBe(DEFAULT_PATTERNS.statusOpen);
  });

  it('Urgent / High / Unassigned / Escalated / Overdue match locale cell text', () => {
    const list = mergeFilterList(defaultPage(), 'tickets');
    const urgent = list.find((r) => r.id === 'urgent')!;
    const high = list.find((r) => r.id === 'high')!;
    const unassigned = list.find((r) => r.id === 'unassigned')!;
    const escalated = list.find((r) => r.id === 'escalated')!;
    const overdue = list.find((r) => r.id === 'overdue')!;
    expect(ruleMatches(item({ priorityText: 'Dringend', priority: null }), urgent, 'tickets')).toBe(true);
    expect(ruleMatches(item({ priorityText: 'asap', priority: null }), urgent, 'tickets')).toBe(false);
    expect(ruleMatches(item({ priority: 4 }), urgent, 'tickets')).toBe(true);
    expect(ruleMatches(item({ priorityText: 'Hoch', priority: null }), high, 'tickets')).toBe(true);
    expect(ruleMatches(item({ agentText: 'Nicht zugewiesen', unassigned: false }), unassigned, 'tickets')).toBe(true);
    expect(ruleMatches(item({ unassigned: true }), unassigned, 'tickets')).toBe(true);
    expect(ruleMatches(item({ escalatedText: 'Eskaliert', escalated: false }), escalated, 'tickets')).toBe(true);
    expect(ruleMatches(item({ escalated: true }), escalated, 'tickets')).toBe(true);
    expect(ruleMatches(item({ dueText: 'Überfällig', dueIn: null }), overdue, 'tickets')).toBe(true);
    expect(ruleMatches(item({ dueIn: -1 }), overdue, 'tickets')).toBe(true);
    expect(ruleMatches(item({ dueIn: 3, dueText: '14-09-2026' }), overdue, 'tickets')).toBe(false);
    const custom = rule({ id: 'asap', name: 'ASAP', criteria: { priorityPattern: 'asap' } });
    expect(ruleMatches(item({ priorityText: 'ASAP', priority: null }), custom, 'tickets')).toBe(true);
    expect(ruleMatches(item({ priority: 4, priorityText: 'Urgent' }), custom, 'tickets')).toBe(false);
    const prioOnly = rule({ id: 'po', name: 'PO', criteria: { priorityPattern: DEFAULT_PATTERNS.priorityUrgent } });
    expect(ruleMatches(item({ priorityText: '4', priority: 4 }), prioOnly, 'tickets')).toBe(true);
    expect(ruleMatches(item({ priority: 4 }), prioOnly, 'tickets')).toBe(true);
    const dueOnly = rule({ id: 'do', name: 'DO', criteria: { duePattern: DEFAULT_PATTERNS.overdue } });
    expect(ruleMatches(item({ dueIn: -1, dueText: null }), dueOnly, 'tickets')).toBe(false);
    expect(ruleMatches(item({ dueText: 'Overdue', dueIn: null }), dueOnly, 'tickets')).toBe(true);
  });

  it('Idle 6d matches Open (locale regex) only when idle is at least 6d', () => {
    const idle = mergeFilterList(defaultPage(), 'tickets').find((r) => r.id === 'idle-6');
    if (!idle) throw new Error('missing idle-6');
    expect(ruleMatches(item({ idleDays: 10, status: 'Open' }), idle, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 10, status: 'Offen' }), idle, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 10, status: 'Pending' }), idle, 'tickets')).toBe(false);
    expect(ruleMatches(item({ idleDays: 0, status: 'Open' }), idle, 'tickets')).toBe(false);
  });

  it('renames Open and matches status without requiring idle', () => {
    const open = mergeFilterList(defaultPage(), 'tickets').find((r) => r.id === 'open-idle');
    expect(open?.name).toBe('Open');
    expect(open?.criteria.idleDays).toBeUndefined();
    expect(open?.criteria.statusPattern).toBeTruthy();
    expect(ruleMatches(item({ idleDays: 0, status: 'Open' }), open!, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 0, status: 'Offen' }), open!, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 10, status: 'Pending' }), open!, 'tickets')).toBe(false);
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
    expect(restored?.criteria.statusPattern).toBe(DEFAULT_PATTERNS.statusOpen);
    expect(restored?.matchMode).toBe('and');
    expect(restored?.enabled).toBe(fork.enabled);
  });
});

describe('mergeFilterList', () => {
  it('keeps invert on a stored custom rule', () => {
    const list = mergeFilterList(defaultPage({
      filters: [rule({ id: 'x', name: 'Not open', invert: true, criteria: { statuses: ['Open'] } })],
    }), 'tickets');
    expect(list.find((r) => r.id === 'x')?.invert).toBe(true);
  });

  it('does not re-insert a default that already has a custom fork', () => {
    const fork = forkFromBuiltin({
      id: 'idle-6',
      name: 'Idle 6d',
      builtin: true,
      enabled: true,
      invert: false,
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
    expect(blankFilter('tickets').invert).toBe(false);
  });
});

describe('new criteria', () => {
  it('idle max forms a band with idle min', () => {
    const r = rule({ id: 'a', name: 'A', matchMode: 'and', criteria: { idleDays: 6, idleDaysMax: 14 } });
    expect(ruleMatches(item({ idleDays: 10 }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 3 }), r, 'tickets')).toBe(false);
    expect(ruleMatches(item({ idleDays: 20 }), r, 'tickets')).toBe(false);
  });

  it('excludes selected statuses even in Any mode', () => {
    const andRule = rule({ id: 'a', name: 'A', matchMode: 'and', criteria: { idleDays: 6, excludeStatuses: ['Closed'] } });
    expect(ruleMatches(item({ idleDays: 10, status: 'Open' }), andRule, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 10, status: 'Closed' }), andRule, 'tickets')).toBe(false);
    const orRule = rule({ id: 'b', name: 'B', matchMode: 'or', criteria: { idleDays: 6, excludeStatuses: ['Closed'] } });
    expect(ruleMatches(item({ idleDays: 1, status: 'Open' }), orRule, 'tickets')).toBe(false);
    expect(ruleMatches(item({ idleDays: 10, status: 'Open' }), orRule, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 10, status: 'Closed' }), orRule, 'tickets')).toBe(false);
  });

  it('swaps inverted idle bounds', () => {
    const r = rule({ id: 'a', name: 'A', matchMode: 'and', criteria: { idleDays: 14, idleDaysMax: 6 } });
    expect(ruleMatches(item({ idleDays: 10 }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ idleDays: 3 }), r, 'tickets')).toBe(false);
  });

  it('does not match a subject phrase split across subject and label', () => {
    const r = rule({ id: 's', name: 'S', criteria: { subjectIncludes: ['VIP'] } });
    expect(ruleMatches(item({ subject: 'VI', label: 'P access' }), r, 'tickets')).toBe(false);
  });

  it('inverts a hit after at least one dimension is active', () => {
    const r = rule({ id: 'a', name: 'A', invert: true, criteria: { statuses: ['Open'] } });
    expect(ruleMatches(item({ status: 'Open' }), r, 'tickets')).toBe(false);
    expect(ruleMatches(item({ status: 'Pending' }), r, 'tickets')).toBe(true);
  });

  it('does not invert an empty rule into matching everything', () => {
    const r = rule({ id: 'a', name: 'A', invert: true, criteria: {} });
    expect(ruleMatches(item(), r, 'tickets')).toBe(false);
  });

  it('matches kind, initiator, and subject on journeys', () => {
    const kind = rule({ id: 'k', name: 'K', criteria: { kinds: ['Internal'] } });
    const who = rule({ id: 'i', name: 'I', criteria: { initiators: ['Pat'] } });
    const sub = rule({ id: 's', name: 'S', criteria: { subjectIncludes: ['VIP'] } });
    expect(ruleMatches(item({ kind: 'Internal' }), kind, 'journeys')).toBe(true);
    expect(ruleMatches(item({ kind: 'External' }), kind, 'journeys')).toBe(false);
    expect(ruleMatches(item({ initiator: 'Pat' }), who, 'journeys')).toBe(true);
    expect(ruleMatches(item({ subject: 'Need VIP access', label: 'Need VIP access' }), sub, 'tickets')).toBe(true);
    expect(ruleMatches(item({ subject: 'Printer', label: 'Printer' }), sub, 'tickets')).toBe(false);
  });

  it('created age, due window, priority, unassigned, and escalated', () => {
    expect(ruleMatches(item({ createdDays: 20 }), rule({ id: 'c', name: 'C', criteria: { createdDays: 14 } }), 'tickets')).toBe(true);
    expect(ruleMatches(item({ createdDays: 2 }), rule({ id: 'c', name: 'C', criteria: { createdDays: 14 } }), 'tickets')).toBe(false);
    expect(ruleMatches(item({ dueIn: -1 }), rule({ id: 'd', name: 'D', criteria: { dueWithin: 0 } }), 'tickets')).toBe(true);
    expect(ruleMatches(item({ dueIn: 2 }), rule({ id: 'd', name: 'D', criteria: { dueWithin: 0 } }), 'tickets')).toBe(false);
    expect(ruleMatches(item({ dueIn: 2 }), rule({ id: 'd', name: 'D', criteria: { dueWithin: 7 } }), 'tickets')).toBe(true);
    expect(ruleMatches(item({ dueIn: null }), rule({ id: 'd', name: 'D', criteria: { dueWithin: 7 } }), 'tickets')).toBe(false);
    expect(ruleMatches(item({ priority: 4 }), rule({ id: 'p', name: 'P', criteria: { priorities: [4] } }), 'tickets')).toBe(true);
    expect(ruleMatches(item({ unassigned: true }), rule({ id: 'u', name: 'U', criteria: { unassigned: true } }), 'tickets')).toBe(true);
    expect(ruleMatches(item({ unassigned: null }), rule({ id: 'u', name: 'U', criteria: { unassigned: true } }), 'tickets')).toBe(false);
    expect(ruleMatches(item({ escalated: true }), rule({ id: 'e', name: 'E', criteria: { escalated: true } }), 'tickets')).toBe(true);
  });

  it('start already passed and progress band', () => {
    const started = rule({ id: 's', name: 'S', criteria: { startPassed: true } });
    expect(ruleMatches(item({ startIn: -1 }), started, 'journeys')).toBe(true);
    expect(ruleMatches(item({ startIn: 0 }), started, 'journeys')).toBe(true);
    expect(ruleMatches(item({ startIn: 3 }), started, 'journeys')).toBe(false);
    const band = rule({ id: 'p', name: 'P', criteria: { minProgress: 25, maxProgress: 60 } });
    expect(ruleMatches(item({ progress: { pct: 40 } }), band, 'journeys')).toBe(true);
    expect(ruleMatches(item({ progress: { pct: 10 } }), band, 'journeys')).toBe(false);
    expect(ruleMatches(item({ progress: { pct: 80 } }), band, 'journeys')).toBe(false);
  });

  it('seeds optional ticket builtins disabled', () => {
    const list = mergeFilterList(defaultPage(), 'tickets');
    expect(list.find((r) => r.id === 'overdue')?.enabled).toBe(false);
    expect(list.find((r) => r.id === 'unassigned')?.builtin).toBe(true);
    expect(list.find((r) => r.id === 'urgent')?.criteria.priorities).toEqual([4]);
    expect(list.find((r) => r.id === 'high')?.enabled).toBe(false);
    expect(list.find((r) => r.id === 'high')?.criteria.priorities).toEqual([3]);
  });

  it('status regex matches DE/EN and ignores invalid patterns', () => {
    const open = rule({ id: 'o', name: 'O', criteria: { statusPattern: 'open|offen' } });
    expect(ruleMatches(item({ status: 'Offen' }), open, 'tickets')).toBe(true);
    expect(ruleMatches(item({ status: 'Pending' }), open, 'tickets')).toBe(false);
    const bad = rule({ id: 'b', name: 'B', criteria: { statusPattern: '(unclosed' } });
    expect(ruleMatches(item({ status: 'Open' }), bad, 'tickets')).toBe(false);
    const third = mergeFilterList(defaultPage(), 'tickets').find((r) => r.id === 'w3p');
    expect(ruleMatches(item({ idleDays: 5, status: 'Warten auf Drittanbieter' }), third!, 'tickets')).toBe(true);
  });

  it('subject regex is Unicode-aware', () => {
    const r = rule({ id: 's', name: 'S', criteria: { subjectPattern: String.raw`\p{L}+phone` } });
    expect(ruleMatches(item({ subject: 'iPhone', label: 'iPhone' }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ subject: 'Laptop', label: 'Laptop' }), r, 'tickets')).toBe(false);
  });

  it('subject regex anchors apply per field, not a joined haystack', () => {
    const r = rule({ id: 's', name: 'S', criteria: { subjectPattern: '^Laptop$' } });
    expect(ruleMatches(item({ subject: 'Laptop', label: 'Laptop · #12' }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ subject: 'Need Laptop now', label: 'Need Laptop now' }), r, 'tickets')).toBe(false);
  });

  it('priority extra matches any selected level', () => {
    const r = rule({ id: 'p', name: 'P', criteria: { priorities: [3, 4] } });
    expect(ruleMatches(item({ priority: 3 }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ priority: 4 }), r, 'tickets')).toBe(true);
    expect(ruleMatches(item({ priority: 1 }), r, 'tickets')).toBe(false);
    expect(ruleMatches(item({ priority: null }), r, 'tickets')).toBe(false);
  });
});

describe('passingCriteria', () => {
  it('lists only the criteria that hold, so the page can outline the right cell', () => {
    const r = rule({ id: 'a', name: 'A', criteria: { idleDays: 6, statuses: ['Pending'] } });
    expect(passingCriteria(item({ idleDays: 1, status: 'Pending' }), r, 'tickets')).toEqual(['statuses']);
    expect(passingCriteria(item({ idleDays: 9, status: 'Pending' }), r, 'tickets')).toEqual(['idleDays', 'statuses']);
  });

  it('returns nothing for inverted rules (no cell explains a non-match)', () => {
    const r = rule({ id: 'a', name: 'A', invert: true, criteria: { idleDays: 6 } });
    expect(passingCriteria(item({ idleDays: 1 }), r, 'tickets')).toEqual([]);
  });

  it('ignores exclude-status, which is a cut rather than a reason', () => {
    const r = rule({ id: 'a', name: 'A', criteria: { excludeStatuses: ['Closed'] } });
    expect(passingCriteria(item({ status: 'Open' }), r, 'tickets')).toEqual([]);
  });
});
