import { describe, expect, it } from 'vitest';
import { parseRecordRef, ticketHrefFor } from './ids';

describe('parseRecordRef', () => {
  it('reads ticket ids', () => {
    expect(parseRecordRef('https://x.freshservice.com/a/tickets/42')).toEqual({ kind: 'ticket', id: 42 });
  });

  it('reads onboarding / journey ids', () => {
    expect(parseRecordRef('/a/employee_onboarding/9')).toEqual({ kind: 'journey', id: 9 });
    expect(parseRecordRef('https://x.freshservice.com/a/journeys/requests/12')).toEqual({ kind: 'journey', id: 12 });
  });

  it('returns null when there is no id', () => {
    expect(parseRecordRef('/a/tickets')).toBeNull();
  });
});

describe('ticketHrefFor', () => {
  it('reuses the sample path', () => {
    expect(ticketHrefFor('https://x.freshservice.com', 99, 'https://x.freshservice.com/a/tickets/1?foo=1')).toBe(
      'https://x.freshservice.com/a/tickets/99',
    );
  });
});
