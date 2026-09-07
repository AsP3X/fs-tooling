import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from './constants';
import { loadSettings, saveSettings, savedPoint } from './settings';

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

describe('savedPoint', () => {
  it('requires both finite axes', () => {
    expect(savedPoint(8, 20)).toEqual({ x: 8, y: 20 });
    expect(savedPoint(8, null)).toBeNull();
    expect(savedPoint(Number.NaN, 1)).toBeNull();
  });
});

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

  it('normalizes inverted from–to dates', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      tickets: { startFrom: '2026-09-20', startTo: '2026-09-10' },
    }));
    const s = loadSettings(storage);
    expect(s.tickets.startFrom).toBe('2026-09-10');
    expect(s.tickets.startTo).toBe('2026-09-20');
  });

  it('round-trips through saveSettings', () => {
    const s = loadSettings(storage);
    s.tickets.days = 9;
    saveSettings(s, storage);
    expect(loadSettings(storage).tickets.days).toBe(9);
  });

  it('keeps collapsed FAB dock independent of the expanded panel point', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      x: 40,
      y: 80,
      fabX: 12,
      fabY: 400,
    }));
    const s = loadSettings(storage);
    expect(s.x).toBe(40);
    expect(s.y).toBe(80);
    expect(s.fabX).toBe(12);
    expect(s.fabY).toBe(400);
  });

  it('drops incomplete or non-finite dock coordinates', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      x: 10,
      y: null,
      fabX: 'left',
      fabY: 20,
    }));
    const s = loadSettings(storage);
    expect(s.x).toBeNull();
    expect(s.y).toBeNull();
    expect(s.fabX).toBeNull();
    expect(s.fabY).toBeNull();
  });
});
