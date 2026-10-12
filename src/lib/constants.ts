// Human: Storage keys, CSS markers, idle buckets, and built-in view presets.
// Agent: READS by settings/match/stats/panel; KEEP key strings stable — they are persisted in page localStorage.

import type { PageSettings, Preset, Settings } from './types';

export const NS = 'sth';
export const HOST_ID = `${NS}-host`;
export const STYLE_ID = `${NS}-page-style`;
/** Default dock for both the expanded panel and the collapsed chip when no saved x/y or fabX/fabY. */
export const HOST_DEFAULT_INSET_PX = 20;
export const ROW_MARK = `${NS}-row`;
export const CELL_MARK = `${NS}-cell`;
export const STORAGE_KEY = `${NS}-settings-v2`;
export const HISTORY_KEY = `${NS}-history-v2`;
/** Ticket-ops ledger: IDs, status labels, and timestamps only. Never names or subjects. */
export const OPS_KEY = `${NS}-ops-v1`;
export const MS_DAY = 86400000;
export const MAX_SNAPS = 90;
export const MAX_OPS_TICKETS = 400;
export const OPS_REOPEN_MS = 2 * 60 * 1000;
/** Minimum gap between API/DOM samples for the same ticket (detail pages mutate constantly). */
export const OPS_SAMPLE_MS = 45 * 1000;
/** Cap stored open timestamps per ticket (sparkline + openCount). */
export const MAX_OPS_OPENS = 80;

// Human: Month tokens from Freshservice cell titles. Keys are lowercase, with and without a trailing dot already stripped.
// Agent: READ by parseTicketDate / parseStartInput. 3-letter forms and the full names that fail a 3-letter cut (Juni, Juli, mars, maj).
export const MONTHS: Record<string, number> = {
  jan: 0, januar: 0, january: 0,
  feb: 1, februar: 1, february: 1,
  mar: 2, mär: 2, märz: 2, mrz: 2, maerz: 2, mars: 2, march: 2,
  apr: 3, april: 3,
  may: 4, mai: 4, maj: 4,
  jun: 5, juni: 5, june: 5, juin: 5,
  jul: 6, juli: 6, july: 6,
  aug: 7, august: 7, augusti: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, okt: 9, oktober: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, dez: 11, dezember: 11, december: 11,
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
  { id: 'open-idle', name: 'Open', days: 6, statuses: ['Open'], matchMode: 'or' },
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
    startFrom: null,
    startTo: null,
    startOpen: false,
    sortKey: 'default',
    sortDir: 'asc',
    filters: [],
    ...overrides,
  };
}

export function defaultSettings(): Settings {
  return {
    module: 'auto',
    collapsed: false,
    x: null,
    y: null,
    fabX: null,
    fabY: null,
    uiOpen: {},
    tickets: defaultPage(),
    journeys: defaultPage({ days: 7, color: '#1565c0' }),
  };
}
