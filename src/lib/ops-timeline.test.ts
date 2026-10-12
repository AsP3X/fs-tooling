import { describe, expect, it } from 'vitest';
import { dwellFromLog, majorityAgentId, parseStatusActivities, statusFromActivity } from './ops-timeline';

describe('statusFromActivity', () => {
  it('reads set-status-as and changed-to lines', () => {
    expect(statusFromActivity('set status as Pending')).toBe('Pending');
    expect(statusFromActivity('Status has been changed from Open to Resolved')).toBe('Resolved');
  });

  it('stops before a following assignment so a name is not stored', () => {
    expect(statusFromActivity('set Status as Open and assigned to Jane Doe')).toBe('Open');
    expect(statusFromActivity('set Status as Waiting on Customer and set Group as Service Desk')).toBe('Waiting on Customer');
  });

  it('reads a status buried in sub_contents', () => {
    const events = parseStatusActivities({
      activities: [{
        created_at: '2026-09-03T00:00:00Z',
        content: 'executed workflow',
        sub_contents: ['set Status as Pending', 'Workflow Ends'],
      }],
    });
    expect(events).toEqual([{ at: Date.parse('2026-09-03T00:00:00Z'), status: 'Pending' }]);
  });

  it('drops lines that are not status changes', () => {
    expect(statusFromActivity('added a private note')).toBeNull();
    expect(statusFromActivity('assigned this ticket to someone')).toBeNull();
  });
});

describe('parseStatusActivities', () => {
  it('keeps times and status only', () => {
    const events = parseStatusActivities({
      activities: [
        { created_at: '2026-09-01T00:00:00Z', content: 'set status as Open', actor: { name: 'Pat' } },
        { created_at: '2026-09-01T02:00:00Z', content: 'changed status to Pending' },
      ],
    });
    expect(events).toEqual([
      { at: Date.parse('2026-09-01T00:00:00Z'), status: 'Open' },
      { at: Date.parse('2026-09-01T02:00:00Z'), status: 'Pending' },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Pat/);
  });
});

describe('dwellFromLog', () => {
  it('accumulates spans between status changes', () => {
    const t0 = Date.parse('2026-09-01T00:00:00Z');
    const t1 = t0 + 3600000;
    const built = dwellFromLog(
      [{ at: t0, status: 'Open' }, { at: t1, status: 'Pending' }],
      t0,
    );
    expect(built?.statusMs.Open).toBe(3600000);
    expect(built?.status).toBe('Pending');
    expect(built?.statusSince).toBe(t1);
  });

  it('does not charge the time before the first change to that new status', () => {
    const created = Date.parse('2026-09-01T00:00:00Z');
    const pendingAt = created + 10 * 86400000;
    const resolvedAt = pendingAt + 2 * 86400000;
    const built = dwellFromLog(
      [{ at: pendingAt, status: 'Pending' }, { at: resolvedAt, status: 'Resolved' }],
      created,
    );
    expect(built?.statusMs.Pending).toBe(2 * 86400000);
    expect(built?.statusMs.Pending).not.toBe(12 * 86400000);
  });
});

describe('majorityAgentId', () => {
  it('needs two tickets to agree', () => {
    expect(majorityAgentId([9])).toBeNull();
    expect(majorityAgentId([9, 9, 4])).toBe(9);
    expect(majorityAgentId([9, 4])).toBeNull();
  });
});
