// Human: Rolling statistics snapshots in localStorage. Values are counts and averages only — no person names.
// Agent: READS/WRITES HISTORY_KEY. Caps at MAX_SNAPS. Filter by module when rendering the report.

import { HISTORY_KEY, MAX_SNAPS } from './constants';
import type { Snapshot } from './types';
import type { Report } from './stats';

export function loadHistory(storage: Storage = localStorage): Snapshot[] {
  try {
    const h = JSON.parse(storage.getItem(HISTORY_KEY) || '[]') as unknown;
    return Array.isArray(h) ? (h as Snapshot[]) : [];
  } catch {
    return [];
  }
}

export function saveSnapshot(report: Report, storage: Storage = localStorage): Snapshot[] {
  const hist = loadHistory(storage);
  hist.push({
    t: Date.now(),
    module: report.module,
    n: report.n,
    idleAvg: report.idle.avg,
    progAvg: report.progress.avg,
    awaiting: report.awaiting,
    processing: report.processing,
  });
  while (hist.length > MAX_SNAPS) hist.shift();
  storage.setItem(HISTORY_KEY, JSON.stringify(hist));
  return hist;
}

export function clearHistory(storage: Storage = localStorage): void {
  storage.removeItem(HISTORY_KEY);
}
