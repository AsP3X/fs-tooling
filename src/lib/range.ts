// Human: Inclusive YYYY-MM-DD from–to range for the results overlay. Never mutates the Freshservice table.
// Agent: PURE. inDateRange is a pass-through when inactive; selectRangeRows returns [] when inactive.

export type RangeMode = 'start' | 'updated';

export function validDateKey(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function normalizeRange(from: unknown, to: unknown): { startFrom: string | null; startTo: string | null } {
  let startFrom = validDateKey(from);
  let startTo = validDateKey(to);
  if (startFrom && startTo && startFrom > startTo) {
    const tmp = startFrom;
    startFrom = startTo;
    startTo = tmp;
  }
  return { startFrom, startTo };
}

export function rangeActive(from: string | null | undefined, to: string | null | undefined): boolean {
  return !!(validDateKey(from) || validDateKey(to));
}

/** Overlay listing is API-only. No key → the control is inert. */
export function rangeListingEnabled(hasKey: boolean): boolean {
  return !!hasKey;
}

/** Apply is enabled only with a key and at least one bound. */
export function rangeApplyReady(
  hasKey: boolean,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  return rangeListingEnabled(hasKey) && rangeActive(from, to);
}

/** Shift a calendar key by whole UTC days. Used to make FS `:<` include the To day. */
export function shiftDateKey(key: string, days: number): string | null {
  const src = validDateKey(key);
  if (!src) return null;
  const [y, m, d] = src.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function formatRangeLabel(from: string | null | undefined, to: string | null | undefined): string {
  const a = validDateKey(from);
  const b = validDateKey(to);
  const fmt = (key: string) => {
    const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : key;
  };
  if (!a && !b) return '';
  if (a && b && a === b) return fmt(a);
  if (a && b) return `${fmt(a)} – ${fmt(b)}`;
  if (a) return `from ${fmt(a)}`;
  return `until ${fmt(b as string)}`;
}

export function rangeDateKey(
  item: { startKey?: string | null; updatedKey?: string | null },
  mode: RangeMode,
): string | null {
  return mode === 'start' ? item.startKey || null : item.updatedKey || null;
}

export function inDateRange(
  key: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  if (!rangeActive(from, to)) return true;
  if (!key) return false;
  const startFrom = validDateKey(from);
  const startTo = validDateKey(to);
  if (startFrom && key < startFrom) return false;
  if (startTo && key > startTo) return false;
  return true;
}

/** Overlay rows only. Inactive range → no rows (unlike inDateRange, which passes through). */
export function selectRangeRows<T extends { startKey?: string | null; updatedKey?: string | null }>(
  items: T[],
  mode: RangeMode,
  from: string | null | undefined,
  to: string | null | undefined,
): T[] {
  if (!rangeActive(from, to)) return [];
  return items.filter((item) => inDateRange(rangeDateKey(item, mode), from, to));
}

export function rangeModeFor(moduleId: string): RangeMode {
  return moduleId === 'journeys' ? 'start' : 'updated';
}
