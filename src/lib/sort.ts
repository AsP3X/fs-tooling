// Human: Sort keys for the visible table page (does not change Freshservice's server order).
// Agent: PURE comparator. Null values sort last in both directions; ties break on original row order.

import type { SortKey, Sortable } from './types';

export function sortValue(item: Sortable, key: SortKey): number | string | null {
  if (key === 'start') return item.start ? item.start.getTime() : null;
  if (key === 'created') return item.created ? item.created.getTime() : null;
  if (key === 'status') return (item.status || '').toLowerCase();
  if (key === 'initiator') return (item.initiator || '').toLowerCase();
  if (key === 'progress') return item.progress.pct == null ? null : item.progress.pct;
  return item.ord;
}

export function compareItems(a: Sortable, b: Sortable, key: SortKey, dir: 1 | -1): number {
  if (key === 'default') return a.ord - b.ord;
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va == null && vb == null) return a.ord - b.ord;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === 'string' && typeof vb === 'string') {
    const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
    return cmp ? cmp * dir : a.ord - b.ord;
  }
  if (va === vb) return a.ord - b.ord;
  return (va as number) < (vb as number) ? -1 * dir : 1 * dir;
}
