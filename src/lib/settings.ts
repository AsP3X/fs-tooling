// Human: Load/save panel settings from the host page's localStorage (shared with Tampermonkey userscript).
// Agent: READS/WRITES STORAGE_KEY. Always merge onto defaults and normalize arrays/enums so old payloads keep working.

import { STORAGE_KEY, defaultSettings } from './constants';
import { normalizeRange } from './range';
import type { MatchMode, PageSettings, Settings, SortDir, SortKey } from './types';

function isMatchMode(v: unknown): v is MatchMode {
  return v === 'and' || v === 'or';
}

function isSortDir(v: unknown): v is SortDir {
  return v === 'asc' || v === 'desc';
}

function isSortKey(v: unknown): v is SortKey {
  return v === 'default' || v === 'start' || v === 'created' || v === 'status' || v === 'initiator' || v === 'progress';
}

export function normalizePage(page: PageSettings): PageSettings {
  const next = { ...page };
  if (!Array.isArray(next.statuses)) next.statuses = [];
  if (!Array.isArray(next.presets)) next.presets = [];
  if (!Array.isArray(next.startDates)) next.startDates = [];
  const range = normalizeRange(next.startFrom, next.startTo);
  next.startFrom = range.startFrom;
  next.startTo = range.startTo;
  if (!isMatchMode(next.matchMode) || next.matchMode !== 'and') next.matchMode = 'or';
  if (!isSortKey(next.sortKey)) next.sortKey = 'default';
  if (!isSortDir(next.sortDir) || next.sortDir !== 'desc') next.sortDir = 'asc';
  return next;
}

export function normalizeSettings(raw: Settings): Settings {
  const next: Settings = {
    ...raw,
    tickets: normalizePage(raw.tickets),
    journeys: normalizePage(raw.journeys),
    uiOpen: { ...(raw.uiOpen || {}) },
  };
  return next;
}

export function loadSettings(storage: Storage = localStorage): Settings {
  const defaults = defaultSettings();
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') as Partial<Settings> & {
      tickets?: Partial<PageSettings>;
      journeys?: Partial<PageSettings>;
    };
    const merged: Settings = {
      ...defaults,
      ...parsed,
      tickets: { ...defaults.tickets, ...(parsed.tickets || {}) },
      journeys: { ...defaults.journeys, ...(parsed.journeys || {}) },
      uiOpen: { ...(parsed.uiOpen || {}) },
    };
    return normalizeSettings(merged);
  } catch {
    return normalizeSettings(defaultSettings());
  }
}

export function saveSettings(settings: Settings, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

