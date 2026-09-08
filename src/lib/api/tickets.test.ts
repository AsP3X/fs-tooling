import { describe, expect, it } from 'vitest';
import { asApiTicket, ticketEscalated, ticketSampleFromJson, ticketToReportable, ticketUnassigned } from './tickets';

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

describe('ticketSampleFromJson', () => {
  it('keeps times and responder id and drops the subject', () => {
    const maps = { byId: new Map([[2, 'Open']]), byName: new Map([['open', 2]]) };
    const sample = ticketSampleFromJson({
      id: 20,
      status: 2,
      subject: 'Secret name here',
      requester_name: 'Pat',
      responder_id: 9,
      created_at: '2026-09-01T00:00:00Z',
      stats: { resolved_at: '2026-09-02T00:00:00Z', first_responded_at: '2026-09-01T01:00:00Z' },
    }, maps);
    expect(sample?.status).toBe('Open');
    expect(sample?.responderId).toBe(9);
    expect(sample?.createdAt).toBe(Date.parse('2026-09-01T00:00:00Z'));
    expect(sample?.resolvedAt).toBe(Date.parse('2026-09-02T00:00:00Z'));
    expect(JSON.stringify(sample)).not.toMatch(/Secret|Pat/);
  });
});
