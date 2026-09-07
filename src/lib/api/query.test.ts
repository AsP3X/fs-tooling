import { describe, expect, it } from 'vitest';
import { defaultPage } from '../constants';
import { buildRuleTicketQuery, buildTicketFilterQuery, buildUpdatedRangeQuery, chunkIds, idleCutoffDate } from './query';

describe('idleCutoffDate', () => {
  it('formats UTC yyyy-mm-dd for N days ago', () => {
    expect(idleCutoffDate(6, Date.UTC(2026, 8, 4, 12, 0, 0))).toBe('2026-08-29');
  });
});

describe('buildTicketFilterQuery', () => {
  const names = new Map([['open', 2], ['pending', 3]]);
  const now = Date.UTC(2026, 8, 4, 12, 0, 0);

  it('OR combines status and idle', () => {
    const q = buildTicketFilterQuery(defaultPage({ days: 6, matchMode: 'or', statuses: ['Open'] }), names, now);
    expect(q).toBe("status:2 OR updated_at:<'2026-08-29'");
  });

  it('AND requires idle and any selected status', () => {
    const q = buildTicketFilterQuery(defaultPage({ days: 6, matchMode: 'and', statuses: ['Open', 'Pending'] }), names, now);
    expect(q).toBe("(status:2 OR status:3) AND updated_at:<'2026-08-29'");
  });

  it('drops unknown status names', () => {
    const q = buildTicketFilterQuery(defaultPage({ days: 6, matchMode: 'or', statuses: ['Nope'] }), names, now);
    expect(q).toBe("updated_at:<'2026-08-29'");
  });

  it('ORs each enabled filter query', () => {
    const cfg = defaultPage({
      filters: [
        { id: 'a', name: 'A', builtin: false, enabled: true, invert: false, color: '#e65100', matchMode: 'or', criteria: { idleDays: 6 } },
        { id: 'b', name: 'B', builtin: false, enabled: true, invert: false, color: '#1565c0', matchMode: 'or', criteria: { statuses: ['Pending'] } },
      ],
    });
    const q = buildTicketFilterQuery(cfg, names, now);
    expect(q).toBe("(updated_at:<'2026-08-29') OR (status:3)");
  });

  it('adds created, due, priority, and unassigned clauses', () => {
    const q = buildRuleTicketQuery(
      {
        id: 'x', name: 'X', builtin: false, enabled: true, invert: false, color: '#e65100', matchMode: 'and',
        criteria: { createdDays: 14, dueWithin: 0, priorities: [3, 4], unassigned: true },
      },
      names,
      now,
    );
    expect(q).toContain("created_at:<'2026-08-21'");
    expect(q).toContain("due_by:<'2026-09-04'");
    expect(q).toContain('priority:3 OR priority:4');
    expect(q).toContain('agent_id:null');
  });

  it('swaps inverted idle min/max in the query band', () => {
    const swapped = buildRuleTicketQuery(
      {
        id: 'x', name: 'X', builtin: false, enabled: true, invert: false, color: '#e65100', matchMode: 'and',
        criteria: { idleDays: 14, idleDaysMax: 6 },
      },
      names,
      now,
    );
    const ordered = buildRuleTicketQuery(
      {
        id: 'y', name: 'Y', builtin: false, enabled: true, invert: false, color: '#e65100', matchMode: 'and',
        criteria: { idleDays: 6, idleDaysMax: 14 },
      },
      names,
      now,
    );
    expect(swapped).toBe(ordered);
    expect(swapped).toContain("updated_at:<'2026-08-29'");
    expect(swapped).toContain("updated_at:>'2026-08-21'");
  });

  it('omits inverted rules from the API query', () => {
    const q = buildRuleTicketQuery(
      {
        id: 'x', name: 'X', builtin: false, enabled: true, invert: true, color: '#e65100', matchMode: 'or',
        criteria: { idleDays: 6 },
      },
      names,
      now,
    );
    expect(q).toBe('');
  });

  it('does not fold the date-range overlay into idle/status matching', () => {
    const q = buildTicketFilterQuery(
      defaultPage({ days: 6, matchMode: 'or', statuses: ['Open'], startFrom: '2026-09-01', startTo: '2026-09-14' }),
      names,
      now,
    );
    expect(q).toBe("status:2 OR updated_at:<'2026-08-29'");
  });
});

describe('buildUpdatedRangeQuery', () => {
  it('bumps To by one UTC day so :< includes that calendar day', () => {
    expect(buildUpdatedRangeQuery('2026-09-01', '2026-09-14')).toBe(
      "updated_at:>'2026-09-01' AND updated_at:<'2026-09-15'",
    );
  });

  it('allows an open From or To', () => {
    expect(buildUpdatedRangeQuery('2026-09-01', null)).toBe("updated_at:>'2026-09-01'");
    expect(buildUpdatedRangeQuery(null, '2026-09-14')).toBe("updated_at:<'2026-09-15'");
  });

  it('swaps inverted bounds before building', () => {
    expect(buildUpdatedRangeQuery('2026-09-20', '2026-09-10')).toBe(
      "updated_at:>'2026-09-10' AND updated_at:<'2026-09-21'",
    );
  });
});

describe('chunkIds', () => {
  it('splits when the query would exceed the cap', () => {
    const chunks = chunkIds([1, 2, 3, 4], 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual([1, 2, 3, 4]);
  });
});
