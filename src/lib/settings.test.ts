import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from './constants';
import { loadSettings, saveSettings } from './settings';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

describe('loadSettings', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('returns defaults when storage is empty', () => {
    const s = loadSettings(storage);
    expect(s.module).toBe('auto');
    expect(s.tickets.days).toBe(6);
    expect(s.journeys.days).toBe(7);
    expect(s.journeys.color).toBe('#1565c0');
    expect(s.tickets.matchMode).toBe('or');
    expect(s.tickets.sortDir).toBe('asc');
  });

  it('merges nested page settings onto defaults', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      module: 'journeys',
      tickets: { days: 12, statuses: ['Open'] },
    }));
    const s = loadSettings(storage);
    expect(s.module).toBe('journeys');
    expect(s.tickets.days).toBe(12);
    expect(s.tickets.statuses).toEqual(['Open']);
    expect(s.tickets.enabled).toBe(true);
    expect(s.tickets.color).toBe('#e65100');
  });

  it('coerces invalid matchMode and missing arrays', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      tickets: { matchMode: 'xor', statuses: 'Open', sortDir: 'up' },
    }));
    const s = loadSettings(storage);
    expect(s.tickets.matchMode).toBe('or');
    expect(s.tickets.statuses).toEqual([]);
    expect(s.tickets.sortDir).toBe('asc');
  });

  it('round-trips through saveSettings', () => {
    const s = loadSettings(storage);
    s.tickets.days = 9;
    saveSettings(s, storage);
    expect(loadSettings(storage).tickets.days).toBe(9);
  });
});
