// Human: Storage keys, CSS markers, idle buckets, and built-in view presets.
// Agent: READS by settings/match/stats/panel; KEEP key strings stable — they are persisted in page localStorage.

import type { PageSettings, Preset, Settings } from './types';

export const NS = 'sth';
export const HOST_ID = `${NS}-host`;
export const STYLE_ID = `${NS}-page-style`;
export const ROW_MARK = `${NS}-row`;
export const CELL_MARK = `${NS}-cell`;
export const STORAGE_KEY = `${NS}-settings-v2`;
export const HISTORY_KEY = `${NS}-history-v2`;
export const MS_DAY = 86400000;
export const MAX_SNAPS = 90;

export const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export const BUCKETS = [
  { key: '<1d', test: (d: number) => d < 1 },
  { key: '1–3d', test: (d: number) => d >= 1 && d < 3 },
  { key: '3–7d', test: (d: number) => d >= 3 && d < 7 },
  { key: '7–14d', test: (d: number) => d >= 7 && d < 14 },
  { key: '14d+', test: (d: number) => d >= 14 },
];

export const PROG_BUCKETS = [
  { key: '0%', test: (p: number) => p === 0 },
  { key: '1–25%', test: (p: number) => p > 0 && p < 25 },
  { key: '25–50%', test: (p: number) => p >= 25 && p < 50 },
  { key: '50–75%', test: (p: number) => p >= 50 && p < 75 },
  { key: '75–99%', test: (p: number) => p >= 75 && p < 100 },
  { key: '100%', test: (p: number) => p >= 100 },
];

export const TICKET_PRESETS: Preset[] = [
  { id: 'idle-6', name: 'Idle 6d', days: 6, statuses: [], matchMode: 'or' },
  { id: 'open-idle', name: 'Open + idle', days: 6, statuses: ['Open'], matchMode: 'and' },
  { id: 'pending-3', name: 'Pending 3d', days: 3, statuses: ['Pending'], matchMode: 'and' },
  { id: 'w3p', name: '3rd party', days: 3, statuses: ['Waiting for third party'], matchMode: 'and' },
];

export const JOURNEY_PRESETS: Preset[] = [
  { id: 'await-3', name: 'Awaiting 3d', days: 3, statuses: ['Awaiting Information'], matchMode: 'and' },
  { id: 'proc-14', name: 'Processing 14d', days: 14, statuses: ['Being Processed'], matchMode: 'and' },
  { id: 'low-prog', name: 'Low progress', days: 7, statuses: [], matchMode: 'or', maxProgress: 40 },
  { id: 'start-soon', name: 'Start ≤7d', days: 1, statuses: [], matchMode: 'or', startWithin: 7 },
];

export function defaultPage(overrides: Partial<PageSettings> = {}): PageSettings {
  return {
    days: 6,
    color: '#e65100',
    enabled: true,
    statuses: [],
    statusOpen: false,
    matchMode: 'or',
    presets: [],
    activePreset: null,
    maxProgress: null,
    startWithin: null,
    startDates: [],
    startOpen: false,
    sortKey: 'default',
    sortDir: 'asc',
    ...overrides,
  };
}

export function defaultSettings(): Settings {
  return {
    module: 'auto',
    collapsed: false,
    x: null,
    y: null,
    uiOpen: {},
    tickets: defaultPage(),
    journeys: defaultPage({ days: 7, color: '#1565c0' }),
  };
}
