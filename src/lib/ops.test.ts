import { describe, expect, it } from 'vitest';
import { OPS_KEY } from './constants';
import {
  applySample,
  buildOpsOverview,
  clearOps,
  liveStatusMs,
  loadOps,
  recordVisit,
  setOpsSelfId,
  shouldRefreshOps,
} from './ops';

function mem(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
}

describe('ops ledger', () => {
  it('counts a new visit and ignores a quick refresh', () => {
    const storage = mem();
    const t0 = 1_000_000;
    recordVisit(42, t0, storage);
    recordVisit(42, t0 + 30_000, storage);
    const row = loadOps(storage).tickets['42'];
    expect(row.openCount).toBe(1);
    expect(row.firstOpenAt).toBe(t0);
    expect(row.lastOpenAt).toBe(t0 + 30_000);
  });

  it('increments openCount after the reopen window', () => {
    const storage = mem();
    recordVisit(7, 0, storage);
    recordVisit(7, 3 * 60 * 1000, storage);
    expect(loadOps(storage).tickets['7'].openCount).toBe(2);
  });

  it('accumulates status dwell when status changes', () => {
    const storage = mem();
    recordVisit(1, 0, storage);
    applySample(1, { status: 'Open' }, 0, storage);
    applySample(1, { status: 'Pending' }, 60_000, storage);
    const row = loadOps(storage).tickets['1'];
    expect(row.status).toBe('Pending');
    expect(row.statusMs.Open).toBe(60_000);
    expect(liveStatusMs(row, 90_000).Pending).toBe(30_000);
  });

  it('counts assignment bounce-back without storing the other agent', () => {
    const storage = mem();
    setOpsSelfId(9, storage);
    recordVisit(5, 0, storage);
    applySample(5, { status: 'Open', responderId: 9 }, 0, storage);
    applySample(5, { status: 'Open', responderId: 44 }, 10, storage);
    applySample(5, { status: 'Open', responderId: 9 }, 20, storage);
    const row = loadOps(storage).tickets['5'];
    expect(row.assignedToSelf).toBe(true);
    expect(row.returnedCount).toBe(1);
    expect(JSON.stringify(storage.getItem(OPS_KEY))).not.toMatch(/44/);
    expect(JSON.parse(storage.getItem(OPS_KEY) || '{}').tickets['5'].responderId).toBeUndefined();
  });

  it('drops names and emails if they appear on a status string', () => {
    const storage = mem();
    recordVisit(3, 0, storage);
    applySample(3, { status: 'pat@example.com' }, 0, storage);
    expect(loadOps(storage).tickets['3'].status).toBe('');
  });

  it('summarizes tracked tickets without using labels from people', () => {
    const storage = mem();
    setOpsSelfId(1, storage);
    recordVisit(10, 0, storage);
    applySample(10, { status: 'Open', createdAt: 0, responderId: 1 }, 0, storage);
    applySample(10, { status: 'Resolved', resolvedAt: 2 * 86400000, responderId: 1 }, 2 * 86400000, storage);
    const overview = buildOpsOverview(loadOps(storage), 2 * 86400000);
    expect(overview.tracked).toBe(1);
    expect(overview.resolved).toBe(1);
    expect(overview.medianHandleMs).toBe(2 * 86400000);
  });

  it('clears the ledger', () => {
    const storage = mem();
    recordVisit(1, 0, storage);
    clearOps(storage);
    expect(loadOps(storage).tickets).toEqual({});
  });

  it('clears resolve time when the ticket is reopened', () => {
    const storage = mem();
    recordVisit(8, 0, storage);
    applySample(8, { status: 'Resolved', resolvedAt: 50_000 }, 50_000, storage);
    expect(loadOps(storage).tickets['8'].resolvedAt).toBe(50_000);
    applySample(8, { status: 'Open' }, 60_000, storage);
    expect(loadOps(storage).tickets['8'].resolvedAt).toBeNull();
  });

  it('does not treat viewing a already-resolved ticket as a negative handle time', () => {
    const storage = mem();
    recordVisit(11, 10_000, storage);
    applySample(11, { status: 'Resolved', createdAt: 1, resolvedAt: 5_000 }, 10_000, storage);
    const overview = buildOpsOverview(loadOps(storage), 10_000);
    expect(overview.resolved).toBe(1);
    expect(overview.medianHandleMs).toBeNull();
    expect(overview.medianAgeMs).toBe(4_999);
  });

  it('keeps a zero lastSeenAt across reload', () => {
    const storage = mem();
    recordVisit(2, 0, storage);
    expect(loadOps(storage).tickets['2'].lastSeenAt).toBe(0);
  });

  it('counts each open on the sparkline, including two on the same day', () => {
    const storage = mem();
    const t0 = Date.parse('2026-09-01T12:00:00Z');
    recordVisit(1, t0, storage);
    recordVisit(1, t0 + 3 * 60 * 1000, storage);
    const overview = buildOpsOverview(loadOps(storage), t0 + 3 * 60 * 1000);
    const day = overview.opensByDay[overview.opensByDay.length - 1];
    expect(loadOps(storage).tickets['1'].openCount).toBe(2);
    expect(day).toBe(2);
  });

  it('rebuilds status dwell from an activity log', () => {
    const storage = mem();
    const t0 = 1_000_000;
    recordVisit(2, t0, storage);
    applySample(2, {
      status: 'Pending',
      createdAt: t0,
      statusLog: [
        { at: t0, status: 'Open' },
        { at: t0 + 60_000, status: 'Pending' },
      ],
    }, t0 + 60_000, storage);
    const row = loadOps(storage).tickets['2'];
    expect(row.statusMs.Open).toBe(60_000);
    expect(row.status).toBe('Pending');
  });

  it('asks for a fresh sample after the min gap', () => {
    const storage = mem();
    const row = recordVisit(1, 10, storage);
    expect(shouldRefreshOps(null, 100, 50)).toBe(true);
    expect(shouldRefreshOps(row, 20, 50)).toBe(false);
    expect(shouldRefreshOps(row, 80, 50)).toBe(true);
    expect(shouldRefreshOps(row, 20, 50, true)).toBe(true);
  });
});
