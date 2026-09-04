// Human: Mutable content-script state (settings, current module, last paint stats).
// Agent: READS/WRITES in-memory settings; persist() writes localStorage. Avoid importing panel from here.

import { loadSettings, saveSettings } from './settings';
import type { ListStats, ModuleId, PageSettings, Settings } from './types';

let settings: Settings | null = null;
let moduleId: ModuleId = 'tickets';
let lastStats: ListStats = { tickets: 0, marked: 0 };

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
