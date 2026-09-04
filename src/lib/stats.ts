// Human: Aggregate idle/progress/start buckets for the statistics panel. Snapshots never store person names.
// Agent: PURE. summarize uses a ceiling percentile (p90 index). buildReport filters the live row list only.

import { BUCKETS, PROG_BUCKETS } from './constants';
import type { ModuleId, RowItem } from './types';

export interface Summary {
  n: number;
  avg: number | null;
  med: number | null;
  p90: number | null;
}

export interface BucketCount {
  key: string;
  n: number;
}

export interface NamedCount {
  name: string;
  n: number;
}

export interface Report {
  module: ModuleId;
  n: number;
  idle: Summary;
  progress: Summary;
  startIn: Summary;
  idleBuckets: BucketCount[];
  progBuckets: BucketCount[];
  byStatus: NamedCount[];
  byKind: NamedCount[];
  awaiting: number;
  processing: number;
  startPast: number;
  startWeek: number;
}

export function summarize(values: Array<number | null | undefined>): Summary {
  const xs = values.filter((n): n is number => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return { n: 0, avg: null, med: null, p90: null };
  const sum = xs.reduce((a, b) => a + b, 0);
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
  return { n: xs.length, avg: sum / xs.length, med: xs[Math.floor((xs.length - 1) / 2)], p90: at(90) };
}

export function bucketize(
  values: Array<number | null | undefined>,
  buckets: Array<{ key: string; test: (n: number) => boolean }>,
): BucketCount[] {
  const xs = values.filter((n): n is number => n != null && Number.isFinite(n));
  return buckets.map((b) => ({ key: b.key, n: xs.filter(b.test).length }));
}

export function groupCount(items: Array<Record<string, unknown>>, key: string): NamedCount[] {
  const map = new Map<string, number>();
  items.forEach((r) => {
    const k = String(r[key] || '—');
    map.set(k, (map.get(k) || 0) + 1);
  });
  return [...map.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

export function buildReport(items: RowItem[], moduleId: ModuleId): Report {
  const idle = items.map((r) => r.idleDays);
  const prog = items.map((r) => r.progress.pct);
  const startIn = items.map((r) => r.startIn);
  return {
    module: moduleId,
    n: items.length,
    idle: summarize(idle),
    progress: summarize(prog),
    startIn: summarize(startIn),
    idleBuckets: bucketize(idle.filter((n) => n != null && n >= 0), BUCKETS),
    progBuckets: bucketize(prog, PROG_BUCKETS),
    byStatus: groupCount(items as unknown as Array<Record<string, unknown>>, 'status'),
    byKind: groupCount(items as unknown as Array<Record<string, unknown>>, 'kind'),
    awaiting: items.filter((r) => /await/i.test(r.status)).length,
    processing: items.filter((r) => /process/i.test(r.status)).length,
    startPast: items.filter((r) => r.startIn != null && r.startIn < 0).length,
    startWeek: items.filter((r) => r.startIn != null && r.startIn >= 0 && r.startIn <= 7).length,
  };
}
