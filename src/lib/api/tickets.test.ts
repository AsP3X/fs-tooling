import { describe, expect, it } from 'vitest';
import { asApiTicket, ticketEscalated, ticketToReportable, ticketUnassigned } from './tickets';

describe('asApiTicket', () => {
  it('reads priority, responder, due, and escalation flags', () => {
    const t = asApiTicket({
      id: 9,
      status: 2,
      subject: 'VPN',
      priority: 4,
      responder_id: null,
      requester_name: 'Pat',
      due_by: '2026-09-01T12:00:00Z',
      is_escalated: true,
      fr_escalated: false,
      created_at: '2026-08-01T12:00:00Z',
      updated_at: '2026-08-20T12:00:00Z',
    });
    expect(t?.priority).toBe(4);
    expect(t?.responderId).toBeNull();
    expect(ticketUnassigned(t!)).toBe(true);
    expect(ticketEscalated(t!)).toBe(true);
    const rec = ticketToReportable(t!, { byId: new Map([[2, 'Open']]), byName: new Map([['open', 2]]) }, Date.UTC(2026, 8, 4, 12, 0, 0));
    expect(rec.unassigned).toBe(true);
    expect(rec.escalated).toBe(true);
    expect(rec.priority).toBe(4);
    expect(rec.dueIn).toBeLessThan(0);
    expect(rec.subject).toBe('VPN');
    expect(rec.initiator).toBe('Pat');
  });

  it('leaves unassigned unknown when the payload has no agent field', () => {
    const t = asApiTicket({ id: 1, status: 2 });
    expect(ticketUnassigned(t!)).toBeNull();
  });
});
