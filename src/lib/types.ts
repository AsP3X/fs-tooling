// Human: Shared domain types for the content script. Keep page settings backward-compatible with sth-settings-v2.
// Agent: READS by every module; WRITES none. Do not rename persisted field names.

export type ModuleId = 'tickets' | 'journeys';
export type ModuleSetting = 'auto' | ModuleId;
export type MatchMode = 'and' | 'or';
export type SortDir = 'asc' | 'desc';
export type SortKey = 'default' | 'start' | 'created' | 'status' | 'initiator' | 'progress';

export interface Preset {
  id: string;
  name: string;
  days: number;
  statuses: string[];
  matchMode: MatchMode;
  maxProgress?: number | null;
  startWithin?: number | null;
  startDates?: string[];
  startFrom?: string | null;
  startTo?: string | null;
}

export interface PageSettings {
  days: number;
  color: string;
  enabled: boolean;
  statuses: string[];
  statusOpen: boolean;
  matchMode: MatchMode;
  presets: Preset[];
  activePreset: string | null;
  maxProgress: number | null;
  startWithin: number | null;
  startDates: string[];
  /** Inclusive YYYY-MM-DD overlay range. Null = unbound. Not used by itemMatches. */
  startFrom: string | null;
  startTo: string | null;
  startOpen: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
}

export interface Settings {
  module: ModuleSetting;
  collapsed: boolean;
  x: number | null;
  y: number | null;
  uiOpen: Record<string, boolean>;
  tickets: PageSettings;
  journeys: PageSettings;
}

export interface Progress {
  done: number | null;
  total: number | null;
  pct: number | null;
}

export interface RowItem {
  row: HTMLTableRowElement;
  cell: Element | null;
  href: string | null;
  status: string;
  idleDays: number | null;
  created: Date | null;
  updated: Date | null;
  start: Date | null;
  startIn: number | null;
  kind: string;
  progress: Progress;
  startKey: string | null;
  updatedKey: string | null;
  initiator: string;
  ord: number;
  label: string;
  recordId: number | null;
  fromApi: boolean;
}

export interface Matchable {
  status: string;
  idleDays: number | null;
  startKey: string | null;
  updatedKey?: string | null;
  startIn: number | null;
  progress: { pct: number | null };
}

export interface Sortable {
  ord: number;
  start: Date | null;
  created: Date | null;
  status: string;
  initiator: string;
  progress: { pct: number | null };
}

export interface Snapshot {
  t: number;
  module: ModuleId;
  n: number;
  idleAvg: number | null;
  progAvg: number | null;
  awaiting: number;
  processing: number;
}

export interface ListStats {
  tickets: number;
  marked: number;
  extraMarked: number;
  fromApi: boolean;
}

export interface Reportable {
  status: string;
  idleDays: number | null;
  startKey: string | null;
  updatedKey?: string | null;
  startIn: number | null;
  progress: { pct: number | null };
  kind: string;
  href?: string | null;
  label?: string;
}
