import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, featureVisible } from './features';
import type { AppContext } from '../lib/context';

const listTickets: AppContext = { module: 'tickets', surface: 'list', path: '/a/tickets' };
const listJourneys: AppContext = { module: 'journeys', surface: 'list', path: '/a/employee_onboarding' };
const detailTickets: AppContext = { module: 'tickets', surface: 'detail', path: '/a/tickets/1' };

function spec(id: string) {
  const s = BUILTIN_FEATURES.find((f) => f.id === id);
  if (!s) throw new Error(id);
  return s;
}

describe('featureVisible', () => {
  it('shows list filters only on list surfaces', () => {
    expect(featureVisible(spec('list-age'), listTickets)).toBe(true);
    expect(featureVisible(spec('list-age'), detailTickets)).toBe(false);
  });

  it('shows start-date only on journey lists', () => {
    expect(featureVisible(spec('start'), listJourneys)).toBe(true);
    expect(featureVisible(spec('start'), listTickets)).toBe(false);
    expect(featureVisible(spec('extra'), listTickets)).toBe(false);
  });

  it('shows the empty hint off-list', () => {
    expect(featureVisible(spec('empty-hint'), listTickets)).toBe(false);
    expect(featureVisible(spec('empty-hint'), detailTickets)).toBe(true);
  });
});
