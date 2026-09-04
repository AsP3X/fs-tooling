// Human: Mutable content-script state (settings, current module, last paint stats).
// Agent: READS/WRITES in-memory settings; persist() writes localStorage. Avoid importing panel from here.

import { loadSettings, saveSettings } from './settings';
import type { ListStats, ModuleId, PageSettings, Reportable, Settings } from './types';

let settings: Settings | null = null;
let moduleId: ModuleId = 'tickets';
let lastStats: ListStats = { tickets: 0, marked: 0, extraMarked: 0, fromApi: false };
let lastMarkedUrls: string[] = [];
let lastReportables: Reportable[] = [];
let lastReportMeta = { truncated: false, fromApi: false };

export function getSettings(): Settings {
  if (!settings) settings = loadSettings();
  return settings;
}

export function getModuleId(): ModuleId {
  return moduleId;
}

export function setModuleId(id: ModuleId): void {
  moduleId = id;
}

export function page(): PageSettings {
  const s = getSettings();
  return s[moduleId] || s.tickets;
}

export function persist(next: Settings): Settings {
  settings = next;
  saveSettings(settings);
  return settings;
}

export function assignRoot(partial: Partial<Settings>): Settings {
  settings = { ...getSettings(), ...partial };
  return settings;
}

export function patchRoot(partial: Partial<Settings>): Settings {
  return persist({ ...getSettings(), ...partial });
}

export function patchPage(partial: Partial<PageSettings>): Settings {
  return persist({ ...getSettings(), [moduleId]: { ...page(), ...partial } });
}

export function getLastStats(): ListStats {
  return lastStats;
}

export function setLastStats(stats: ListStats): void {
  lastStats = stats;
}

export function getLastMarkedUrls(): string[] {
  return lastMarkedUrls;
}

export function setLastMarkedUrls(urls: string[]): void {
  lastMarkedUrls = urls;
}

export function getLastReportables(): Reportable[] {
  return lastReportables;
}

export function setLastReportables(items: Reportable[], meta: { truncated: boolean; fromApi: boolean }): void {
  lastReportables = items;
  lastReportMeta = meta;
}

export function getLastReportMeta(): { truncated: boolean; fromApi: boolean } {
  return lastReportMeta;
}
