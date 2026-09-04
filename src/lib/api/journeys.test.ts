import { describe, expect, it } from 'vitest';
import { journeyToReportable, progressFromChildTickets, startFromCustomFields } from './journeys';

describe('startFromCustomFields', () => {
  it('prefers a start/date field', () => {
    const d = startFromCustomFields({ cf_text: 'hello', cf_date: '2026-09-14' });
    expect(d?.toISOString().startsWith('2026-09-14')).toBe(true);
  });

  it('ignores user objects', () => {
    expect(startFromCustomFields({ cf_agents_dd: { id: 1, name: 'Pat' } })).toBeNull();
  });
});

describe('journeyToReportable', () => {
  it('falls back to Start DD-MM-YYYY in the title when custom fields have no date', () => {
    const rec = journeyToReportable(
      { id: 9, title: 'Onboarding - Start 14-09-2026 (Internal employee)' },
      Date.UTC(2026, 8, 1),
    );
    expect(rec.startKey).toBe('2026-09-14');
    expect(rec.label).toContain('Onboarding');
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
