import { describe, expect, it } from 'vitest';
import { progressFromChildTickets, startFromCustomFields } from './journeys';

describe('startFromCustomFields', () => {
  it('prefers a start/date field', () => {
    const d = startFromCustomFields({ cf_text: 'hello', cf_date: '2026-09-14' });
    expect(d?.toISOString().startsWith('2026-09-14')).toBe(true);
  });

  it('ignores user objects', () => {
    expect(startFromCustomFields({ cf_agents_dd: { id: 1, name: 'Pat' } })).toBeNull();
  });
});

describe('progressFromChildTickets', () => {
  it('counts resolved/closed as done', () => {
    const p = progressFromChildTickets([{ status: 2 }, { status: 5 }, { status: 'Resolved' }]);
    expect(p.total).toBe(3);
    expect(p.done).toBe(2);
    expect(p.pct).toBeCloseTo(200 / 3);
  });
});
