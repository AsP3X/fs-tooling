// Human: Local ticket-ops ledger. Tracks opens, status dwell, resolve time, and assignment bounce-back.
// Agent: READS/WRITES OPS_KEY. Never persists names, emails, subjects, or other agent ids. Ticket numeric id + status labels + timestamps only.

import { MAX_OPS_OPENS, MAX_OPS_TICKETS, OPS_KEY, OPS_REOPEN_MS } from './constants';
import { dwellFromLog, type StatusLogEvent } from './ops-timeline';

export interface TicketOps {
  id: number;
  firstOpenAt: number;
  lastOpenAt: number;
  openCount: number;
  status: string;
  statusSince: number;
  /** Accumulated milliseconds spent in each status label. */
  statusMs: Record<string, number>;
  createdAt: number | null;
  resolvedAt: number | null;
  closedAt: number | null;
  firstRespondedAt: number | null;
  /** True when the last sample said this browser's agent holds the ticket. */
  assignedToSelf: boolean | null;
  /** True after it left us and we are waiting to see it come back. */
  awaitingReturn: boolean;
  /** Times it came back to this agent after leaving. */
  returnedCount: number;
  lastSeenAt: number;
  /** Open timestamps (capped). Used for the 14-day sparkline. */
  openAt: number[];
}

export interface OpsLedger {
  v: 1;
  /** Logged-in agent numeric id. Never a name. */
  selfId: number | null;
  tickets: Record<string, TicketOps>;
}

export interface TicketSample {
  status?: string;
  createdAt?: number | null;
  resolvedAt?: number | null;
  closedAt?: number | null;
  firstRespondedAt?: number | null;
  /** undefined = unknown; null = unassigned. Never stored. */
  responderId?: number | null;
  statusLog?: StatusLogEvent[];
}

function blankLedger(): OpsLedger {
  return { v: 1, selfId: null, tickets: {} };
}

export function emptyTicketOps(id: number, now: number): TicketOps {
  return {
    id,
    firstOpenAt: now,
    lastOpenAt: now,
    openCount: 1,
    status: '',
    statusSince: now,
    statusMs: {},
    createdAt: null,
    resolvedAt: null,
    closedAt: null,
    firstRespondedAt: null,
    assignedToSelf: null,
    awaitingReturn: false,
    returnedCount: 0,
    lastSeenAt: now,
    openAt: [now],
  };
}

function asInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function asTs(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function asTsOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asStatus(raw: unknown): string {
  const s = String(raw || '').trim().slice(0, 40);
  if (!s || /@/.test(s)) return '';
  return s;
}

function asTicket(raw: unknown, fallbackId: number): TicketOps | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = asInt(rec.id) || fallbackId;
  if (!id) return null;
  const now = Date.now();
  const statusMs: Record<string, number> = {};
  if (rec.statusMs && typeof rec.statusMs === 'object') {
    Object.entries(rec.statusMs as Record<string, unknown>).forEach(([key, value]) => {
      const label = asStatus(key);
      const ms = Number(value);
      if (label && Number.isFinite(ms) && ms >= 0) statusMs[label] = ms;
    });
  }
  return {
    id,
    firstOpenAt: asTs(rec.firstOpenAt, now),
    lastOpenAt: asTs(rec.lastOpenAt, now),
    openCount: Math.max(1, Math.floor(Number(rec.openCount) || 1)),
    status: asStatus(rec.status),
    statusSince: asTs(rec.statusSince, now),
    statusMs,
    createdAt: asTsOrNull(rec.createdAt),
    resolvedAt: asTsOrNull(rec.resolvedAt),
    closedAt: asTsOrNull(rec.closedAt),
    firstRespondedAt: asTsOrNull(rec.firstRespondedAt),
    assignedToSelf: rec.assignedToSelf === true ? true : rec.assignedToSelf === false ? false : null,
    awaitingReturn: rec.awaitingReturn === true,
    returnedCount: Math.max(0, Math.floor(Number(rec.returnedCount) || 0)),
    lastSeenAt: asTs(rec.lastSeenAt, now),
    openAt: Array.isArray(rec.openAt)
      ? rec.openAt.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0).slice(-MAX_OPS_OPENS)
      : [asTs(rec.firstOpenAt, now)],
  };
}

export function loadOps(storage: Storage = localStorage): OpsLedger {
  try {
    const parsed = JSON.parse(storage.getItem(OPS_KEY) || 'null') as unknown;
    if (!parsed || typeof parsed !== 'object') return blankLedger();
    const rec = parsed as Record<string, unknown>;
    const tickets: Record<string, TicketOps> = {};
    const rawTickets = rec.tickets && typeof rec.tickets === 'object' ? rec.tickets as Record<string, unknown> : {};
    Object.entries(rawTickets).forEach(([key, value]) => {
      const id = asInt(key);
      const row = asTicket(value, id || 0);
      if (row) tickets[String(row.id)] = row;
    });
    return { v: 1, selfId: asInt(rec.selfId), tickets };
  } catch {
    return blankLedger();
  }
}

function prune(ledger: OpsLedger): void {
  const rows = Object.values(ledger.tickets).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  if (rows.length <= MAX_OPS_TICKETS) return;
  const keep = new Set(rows.slice(0, MAX_OPS_TICKETS).map((row) => String(row.id)));
  Object.keys(ledger.tickets).forEach((key) => {
    if (!keep.has(key)) delete ledger.tickets[key];
  });
}

export function saveOps(ledger: OpsLedger, storage: Storage = localStorage): void {
  prune(ledger);
  storage.setItem(OPS_KEY, JSON.stringify({
    v: 1,
    selfId: ledger.selfId,
    tickets: ledger.tickets,
  }));
}

export function clearOps(storage: Storage = localStorage): void {
  storage.removeItem(OPS_KEY);
}

export function setOpsSelfId(selfId: number | null, storage: Storage = localStorage): OpsLedger {
  const ledger = loadOps(storage);
  const id = selfId != null && Number.isFinite(selfId) && selfId > 0 ? Math.floor(selfId) : null;
  if (ledger.selfId !== id) {
    ledger.selfId = id;
    saveOps(ledger, storage);
  }
  return ledger;
}

/**
 * Count a detail-page visit. Re-opens within OPS_REOPEN_MS do not increment openCount.
 * Agent: WRITES tickets[id]. Never writes a subject or person field.
 */
export function recordVisit(id: number, now = Date.now(), storage: Storage = localStorage): TicketOps {
  const ledger = loadOps(storage);
  const key = String(id);
  let row = ledger.tickets[key];
  if (!row) {
    row = emptyTicketOps(id, now);
    ledger.tickets[key] = row;
  } else {
    if (now - row.lastOpenAt >= OPS_REOPEN_MS) {
      row.openCount += 1;
      row.openAt = [...(row.openAt || []), now].slice(-MAX_OPS_OPENS);
    }
    row.lastOpenAt = now;
    row.lastSeenAt = now;
  }
  saveOps(ledger, storage);
  return row;
}

export function liveStatusMs(row: TicketOps, now = Date.now()): Record<string, number> {
  const out = { ...row.statusMs };
  if (!row.status) return out;
  const extra = Math.max(0, now - row.statusSince);
  out[row.status] = (out[row.status] || 0) + extra;
  return out;
}

function isClosedLabel(status: string): boolean {
  return /^(resolved|closed)$/i.test(status.trim());
}

/**
 * Merge a desk sample (API or DOM). Assignment bounce uses selfId vs responderId in memory only.
 * Agent: WRITES status/times/assignedToSelf/returnedCount. DROPS responderId.
 */
export function applySample(
  id: number,
  sample: TicketSample,
  now = Date.now(),
  storage: Storage = localStorage,
): TicketOps {
  const ledger = loadOps(storage);
  const key = String(id);
  const row = ledger.tickets[key] || emptyTicketOps(id, now);
  if (!ledger.tickets[key]) ledger.tickets[key] = row;

  if (sample.createdAt && !row.createdAt) row.createdAt = sample.createdAt;
  if (sample.firstRespondedAt && !row.firstRespondedAt) row.firstRespondedAt = sample.firstRespondedAt;

  const nextStatus = asStatus(sample.status);
  if (sample.statusLog && sample.statusLog.length) {
    const built = dwellFromLog(sample.statusLog, row.createdAt || sample.createdAt || null);
    if (built) {
      row.statusMs = built.statusMs;
      if (nextStatus && nextStatus.toLowerCase() !== built.status.toLowerCase()) {
        row.status = nextStatus;
        row.statusSince = now;
      } else {
        row.status = built.status;
        row.statusSince = built.statusSince;
      }
    }
  } else if (nextStatus && nextStatus.toLowerCase() !== row.status.toLowerCase()) {
    if (row.status) {
      const dt = Math.max(0, now - row.statusSince);
      row.statusMs[row.status] = (row.statusMs[row.status] || 0) + dt;
    }
    row.status = nextStatus;
    row.statusSince = now;
  }

  if (nextStatus && !isClosedLabel(nextStatus)) {
    row.resolvedAt = null;
    row.closedAt = null;
  } else {
    if (sample.resolvedAt) row.resolvedAt = sample.resolvedAt;
    if (sample.closedAt) row.closedAt = sample.closedAt;
    if (!row.resolvedAt && nextStatus && isClosedLabel(nextStatus)) row.resolvedAt = now;
  }

  const selfId = ledger.selfId;
  if (selfId != null && sample.responderId !== undefined) {
    const mine = sample.responderId != null && sample.responderId === selfId;
    if (row.assignedToSelf === true && !mine) row.awaitingReturn = true;
    if (row.awaitingReturn && mine) {
      row.returnedCount += 1;
      row.awaitingReturn = false;
    }
    row.assignedToSelf = mine;
  }

  row.lastSeenAt = now;
  saveOps(ledger, storage);
  return row;
}

export function getTicketOps(id: number, storage: Storage = localStorage): TicketOps | null {
  return loadOps(storage).tickets[String(id)] || null;
}

export function shouldRefreshOps(row: TicketOps | null, now: number, minMs: number, force = false): boolean {
  if (force || !row) return true;
  return now - row.lastSeenAt >= minMs;
}

export interface OpsOverview {
  tracked: number;
  openedWeek: number;
  assignedToSelf: number;
  returned: number;
  resolved: number;
  medianHandleMs: number | null;
  medianAgeMs: number | null;
  statusDwell: Array<{ key: string; n: number }>;
  opensByDay: number[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  return xs[Math.floor((xs.length - 1) / 2)];
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function buildOpsOverview(ledger: OpsLedger, now = Date.now()): OpsOverview {
  const rows = Object.values(ledger.tickets);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const handle: number[] = [];
  const age: number[] = [];
  const dwell = new Map<string, number>();
  rows.forEach((row) => {
    const live = liveStatusMs(row, now);
    Object.entries(live).forEach(([key, ms]) => dwell.set(key, (dwell.get(key) || 0) + ms));
    const done = row.resolvedAt || row.closedAt;
    if (done) {
      if (done >= row.firstOpenAt) handle.push(done - row.firstOpenAt);
      if (row.createdAt && done >= row.createdAt) age.push(done - row.createdAt);
    }
  });
  const stamps: number[] = [];
  rows.forEach((row) => {
    if (row.openAt && row.openAt.length) stamps.push(...row.openAt);
    else {
      stamps.push(row.firstOpenAt);
      if (row.lastOpenAt !== row.firstOpenAt) stamps.push(row.lastOpenAt);
    }
  });
  const days: number[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const t = now - i * 24 * 60 * 60 * 1000;
    const key = dayKey(t);
    days.push(stamps.filter((stamp) => dayKey(stamp) === key).length);
  }
  const statusDwell = [...dwell.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  return {
    tracked: rows.length,
    openedWeek: rows.filter((row) => row.lastOpenAt >= weekAgo).length,
    assignedToSelf: rows.filter((row) => row.assignedToSelf === true && !row.resolvedAt).length,
    returned: rows.filter((row) => row.returnedCount > 0).length,
    resolved: rows.filter((row) => !!(row.resolvedAt || row.closedAt)).length,
    medianHandleMs: median(handle),
    medianAgeMs: median(age),
    statusDwell,
    opensByDay: days,
  };
}
