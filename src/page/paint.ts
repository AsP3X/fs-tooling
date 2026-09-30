// Human: Highlight matching rows, inject the start column, and visually sort the visible table page.
// Agent: WRITES row/cell CSS classes, --sth-mark, data-stale-days, and position/top on rows for the
// visual sort. NEVER moves Freshservice's <tr> nodes (Glimmer tracks rows by DOM position). CALLS
// enrichList when an API key is available. Keeps existing marks until the new hit set is ready so async
// enrich cannot flash the highlight, but drops a mark as soon as its row shows a different ticket.

import { enrichList } from '../lib/api/enrich';
import { CELL_MARK, ROW_MARK } from '../lib/constants';
import { detectModule } from '../lib/detect';
import { emphasisCell, idleExplainingCell } from '../lib/emphasis';
import { firstMatchingFilter, passingCriteria } from '../lib/filters';
import { collectRows, rowKey, rowTbody } from '../lib/rows';
import { compareItems } from '../lib/sort';
import { getLastMarkedUrls, getModuleId, getSettings, page, setLastMarkedUrls, setLastReportables, setLastStats, setModuleId } from '../lib/state';
import type { RowItem, SortKey } from '../lib/types';
import { isNaturalOrder, visualOffsets, type RowBox } from '../lib/visual-order';
import { runtime } from './runtime';
import { injectStartColumn } from './start-column';

let paintGen = 0;
/** Set by disposePaint() when a newer content-script instance takes over (extension reload). */
let disposed = false;

// ---------------------------------------------------------------------------
// Row highlight state
// ---------------------------------------------------------------------------

/** What we painted on a row, so it can be re-applied after Ember rewrites the class/style attribute. */
interface MarkState {
  /** rowKey() at paint time. A different key means Freshservice recycled the row for another ticket. */
  key: string;
  color: string;
  staleDays: string | null;
  cell: Element | null;
}

const marks = new Map<HTMLTableRowElement, MarkState>();

export interface RowHit {
  item: RowItem;
  color: string;
  /** Cell to outline. Omitted → item.cell (the Updated/Created date), for older callers. */
  cell?: Element | null;
}

// Agent: Idempotent — only writes attributes that differ, so the attribute guard observer cannot loop.
function applyMark(row: HTMLTableRowElement, state: MarkState): void {
  if (!row.classList.contains(ROW_MARK)) row.classList.add(ROW_MARK);
  if (row.style.getPropertyValue('--sth-mark') !== state.color) row.style.setProperty('--sth-mark', state.color);
  if (state.staleDays == null) {
    if (row.hasAttribute('data-stale-days')) row.removeAttribute('data-stale-days');
  } else if (row.dataset.staleDays !== state.staleDays) {
    row.dataset.staleDays = state.staleDays;
  }
  const cell = state.cell;
  if (cell && cell.isConnected && row.contains(cell) && !cell.classList.contains(CELL_MARK)) cell.classList.add(CELL_MARK);
}

function removeMark(row: Element, cell: Element | null): void {
  if (row.classList.contains(ROW_MARK)) row.classList.remove(ROW_MARK);
  if (row.hasAttribute('data-stale-days')) row.removeAttribute('data-stale-days');
  if (row instanceof HTMLElement && row.style.getPropertyValue('--sth-mark')) row.style.removeProperty('--sth-mark');
  if (cell?.classList.contains(CELL_MARK)) cell.classList.remove(CELL_MARK);
}

/** Add/remove highlight classes without blanking the current set first. */
export function syncRowMarks(hits: RowHit[], enabled: boolean, doc: Document = document): void {
  const next = new Map<HTMLTableRowElement, MarkState>();
  if (enabled) {
    hits.forEach(({ item, color, cell }) => {
      next.set(item.row, {
        key: item.href || '',
        color,
        staleDays: item.idleDays != null ? String(Math.floor(item.idleDays)) : null,
        cell: cell === undefined ? item.cell : cell,
      });
    });
  }
  // Drop rows that are no longer hits, and outlines that moved to another cell.
  marks.forEach((state, row) => {
    const keep = next.get(row);
    if (!keep) removeMark(row, state.cell);
    else if (state.cell && state.cell !== keep.cell) state.cell.classList.remove(CELL_MARK);
  });
  // Strays from an earlier content-script instance (extension reload) are not in `marks`.
  const wantedCells = new Set([...next.values()].map((s) => s.cell).filter((c): c is Element => !!c));
  doc.querySelectorAll(`tr.${ROW_MARK}`).forEach((el) => {
    if (!next.has(el as HTMLTableRowElement)) removeMark(el, null);
  });
  doc.querySelectorAll(`.${CELL_MARK}`).forEach((el) => {
    if (!wantedCells.has(el)) el.classList.remove(CELL_MARK);
  });
  marks.clear();
  next.forEach((state, row) => {
    marks.set(row, state);
    applyMark(row, state);
  });
}

// ---------------------------------------------------------------------------
// Visual sort (position:relative + top; DOM order untouched)
// ---------------------------------------------------------------------------

interface ShiftState {
  top: string;
  /** Inline values before we touched the row, restored when the sort is cleared. */
  prevPosition: string;
  prevTop: string;
}

const shifts = new Map<HTMLTableRowElement, ShiftState>();
const SHIFT_ATTR = 'data-sth-shift';
/** Header cells we lifted above shifted rows (their own z-index was auto). */
const LIFT_ATTR = 'data-sth-z';

function applyShift(row: HTMLTableRowElement, state: ShiftState): void {
  if (row.style.position !== 'relative') row.style.position = 'relative';
  if (row.style.top !== state.top) row.style.top = state.top;
  if (!row.hasAttribute(SHIFT_ATTR)) row.setAttribute(SHIFT_ATTR, '');
}

function setShift(row: HTMLTableRowElement, offset: number): void {
  const prev = shifts.get(row);
  if (!offset) {
    if (prev) clearShift(row, prev);
    return;
  }
  // A row still carrying data-sth-shift was shifted by an earlier instance: its inline position/top are
  // ours, not Freshservice's, so they must not be restored later.
  const foreign = !prev && row.hasAttribute(SHIFT_ATTR);
  const state: ShiftState = prev
    ? { ...prev, top: `${offset}px` }
    : {
      top: `${offset}px`,
      prevPosition: foreign ? '' : row.style.position,
      prevTop: foreign ? '' : row.style.top,
    };
  shifts.set(row, state);
  applyShift(row, state);
}

function clearShift(row: HTMLTableRowElement, state: ShiftState | null): void {
  shifts.delete(row);
  row.style.position = state?.prevPosition || '';
  row.style.top = state?.prevTop || '';
  row.removeAttribute(SHIFT_ATTR);
}

/** Pixels this row is shifted by — ours, or an earlier instance's (data-sth-shift) — 0 when untouched. */
function appliedOffset(row: HTMLTableRowElement): number {
  if (!shifts.has(row) && !row.hasAttribute(SHIFT_ATTR)) return 0;
  if (row.style.position !== 'relative') return 0;
  const px = parseFloat(row.style.top);
  return Number.isFinite(px) ? px : 0;
}

// Human: Natural (unshifted) boxes of the rows, relative to their tbody. Sub-pixel exact (offsetTop and
// offsetHeight are rounded integers, which drifts at browser zoom).
// Agent: READS getBoundingClientRect. The relative offset shows up in the rect, so it is subtracted.
function naturalBoxes(body: HTMLTableSectionElement, rows: HTMLTableRowElement[]): RowBox[] {
  const origin = body.getBoundingClientRect().top;
  return rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { top: rect.top - origin - appliedOffset(row), height: rect.height };
  });
}

// Human: The offset math assumes the tbody is a plain stack of laid-out list rows. Hidden rows, rows out of
// order, or other visible children (expansion rows, spacers) would make rows overlap — do not sort then.
// Agent: PURE over measured boxes + tbody children. RETURNS false to clear offsets for this tbody.
function stackIsSortable(body: HTMLTableSectionElement, rows: HTMLTableRowElement[], boxes: RowBox[]): boolean {
  if (boxes.some((b) => !(b.height > 0))) return false;
  for (let i = 1; i < boxes.length; i += 1) {
    if (boxes[i].top < boxes[i - 1].top + boxes[i - 1].height - 0.5) return false;
  }
  const listRows = new Set<Element>(rows);
  return ![...body.children].some((el) => !listRows.has(el) && el.getBoundingClientRect().height > 0);
}

export function visibleTableRows(body: HTMLTableSectionElement): HTMLTableRowElement[] {
  return [...body.children].filter((el): el is HTMLTableRowElement =>
    el instanceof HTMLTableRowElement && el.classList.contains('et-tr'));
}

/** ember-table only renders part of the list when occlusion is on; shifting a partial set would overlap. */
export function occlusionActive(body: HTMLTableSectionElement): boolean {
  // Spacers sit next to the <table> inside .ember-table-overflow, not in the tbody.
  const scope = body.closest('.ember-table-overflow, .ember-table') || body.closest('table')?.parentElement || body;
  return [...scope.querySelectorAll('occluded-content')].some((el) => {
    const h = parseFloat((el as HTMLElement).style.height || '0');
    return h > 0 || (el as HTMLElement).offsetHeight > 0;
  });
}

// Human: Offsets are only valid for the row heights they were measured with. Fonts loading, column
// resizing, or content re-rendering can change heights without adding/removing rows, so watch the rows of
// sorted tbodies and re-measure on the next frame.
// Agent: Re-observes only when the watched row set changes (observe() fires an initial callback, so
// re-observing on every reflow would loop). Disconnected while nothing is shifted.
let lastOrderItems: RowItem[] = [];
let sizeObserver: ResizeObserver | null = null;
let watchedRows = new Set<HTMLTableRowElement>();
let reflowQueued = false;

function queueReflow(): void {
  if (reflowQueued) return;
  reflowQueued = true;
  const run = (): void => {
    reflowQueued = false;
    if (disposed) return;
    applyVisualOrder(lastOrderItems.filter((item) => item.row.isConnected));
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function watchRowSizes(rows: Set<HTMLTableRowElement>): void {
  if (typeof ResizeObserver === 'undefined') return;
  const same = rows.size === watchedRows.size && [...rows].every((row) => watchedRows.has(row));
  if (same) return;
  sizeObserver?.disconnect();
  watchedRows = rows;
  if (!rows.size) return;
  if (!sizeObserver) sizeObserver = new ResizeObserver(() => queueReflow());
  rows.forEach((row) => sizeObserver?.observe(row));
}

// Human: Circuit breaker. If Freshservice keeps re-rendering the list right after we sort (for example a
// lazily rendered list re-measuring shifted rows on scroll), sorting and re-sorting would oscillate. After
// a few snap-backs in a short window, pause the visual sort for this sort key and tell the user.
// Agent: WRITES sortPausedFor ('key:dir'); cleared when the user picks another sort. CALLS runtime.notify.
const SNAP_LIMIT = 4;
const SNAP_WINDOW_MS = 10_000;
let snapTimes: number[] = [];
let sortPausedFor: string | null = null;

export const SORT_PAUSED_NOTICE = 'Sorting paused: Freshservice keeps re-rendering this list, so the panel sort would flicker. Pick another sort or reload the page to try again.';

function noteSnapBack(now: number = Date.now()): void {
  const key = `${page().sortKey}:${page().sortDir}`;
  snapTimes = [...snapTimes.filter((t) => now - t < SNAP_WINDOW_MS), now];
  if (snapTimes.length < SNAP_LIMIT || sortPausedFor === key) return;
  sortPausedFor = key;
  snapTimes = [];
  runtime.notify(SORT_PAUSED_NOTICE);
}

// Human: Shifted rows are positioned (position:relative), so they paint in tree order *after* a pinned header
// cell whose z-index is auto and would cover it while scrolling. Give such header cells z-index 1 while
// their table is sorted, and hand it back afterwards.
// Agent: READS getComputedStyle(th).zIndex. WRITES inline z-index + data-sth-z on thead th only.
function liftHeaders(tables: Set<HTMLTableElement>, doc: Document): void {
  doc.querySelectorAll(`th[${LIFT_ATTR}]`).forEach((el) => {
    const th = el as HTMLElement;
    const table = th.closest('table');
    if (table && tables.has(table)) return;
    // The attribute holds the inline z-index we replaced.
    th.style.zIndex = th.getAttribute(LIFT_ATTR) || '';
    th.removeAttribute(LIFT_ATTR);
  });
  const view = doc.defaultView;
  if (!view) return;
  tables.forEach((table) => {
    table.querySelectorAll(':scope > thead th').forEach((el) => {
      const th = el as HTMLElement;
      if (th.hasAttribute(LIFT_ATTR)) {
        // Ember rewrote the style (column resize): lift again.
        if (th.style.zIndex !== '1') th.style.zIndex = '1';
        return;
      }
      const z = view.getComputedStyle(th).zIndex;
      // z-index 0 shares the positioned layer with z-index auto, so rows would still cover it.
      if (z && z !== 'auto' && z !== '0') return;
      th.setAttribute(LIFT_ATTR, th.style.zIndex);
      th.style.zIndex = '1';
    });
  });
}

/** True while at least one row is visually displaced (the on-screen order differs from Freshservice's). */
export function visualSortActive(): boolean {
  return shifts.size > 0;
}

// Human: Sort the visible page by offsetting rows instead of moving them.
// Agent: READS offsetTop/offsetHeight (layout). WRITES position/top + data-sth-shift. Re-runs on row resize.
// Clears all shifts in a tbody when: sort is Default, the sort is paused, occlusion is on, or the rows are not
// a plain laid-out stack. Leaves a sorted tbody alone when the item set does not cover every row (a recycled
// row was skipped; the observers already snapped it back and a repaint is queued).
export function applyVisualOrder(items: RowItem[], doc: Document = document): void {
  if (disposed) return;
  lastOrderItems = items;
  const cfg = page();
  const key: SortKey = cfg.sortKey || 'default';
  const dir: 1 | -1 = cfg.sortDir === 'desc' ? -1 : 1;
  const groups = new Map<HTMLTableSectionElement, RowItem[]>();
  items.forEach((item) => {
    const body = rowTbody(item.row);
    if (!body) return;
    const list = groups.get(body);
    if (list) list.push(item);
    else groups.set(body, [item]);
  });
  const touched = new Set<HTMLTableRowElement>();
  // Same 'key:dir' shape as noteSnapBack(). Default or a different sort resets the breaker.
  const sortKeyId = `${key}:${cfg.sortDir}`;
  if (key === 'default') snapTimes = [];
  if (sortPausedFor && sortPausedFor !== sortKeyId) sortPausedFor = null;
  groups.forEach((list, body) => {
    const natural = visibleTableRows(body);
    natural.forEach((row) => touched.add(row));
    const clearAll = (): void => natural.forEach((row) => setShift(row, 0));
    // Default / occlusion / paused never need the item set, so they clear even while a row is skipped.
    if (key === 'default' || sortPausedFor === sortKeyId || occlusionActive(body)) {
      clearAll();
      return;
    }
    const index = new Map(natural.map((row, i) => [row, i] as const));
    const covers = list.length === natural.length && list.every((item) => index.has(item.row));
    if (!covers) return;
    const order = [...list].sort((a, b) => compareItems(a, b, key, dir)).map((item) => index.get(item.row) as number);
    if (isNaturalOrder(order)) {
      clearAll();
      return;
    }
    const boxes = naturalBoxes(body, natural);
    if (!stackIsSortable(body, natural, boxes)) {
      clearAll();
      return;
    }
    const offsets = visualOffsets(boxes, order);
    natural.forEach((row, i) => setShift(row, Math.round(offsets[i] * 100) / 100));
  });
  // Rows that left the list, and strays from an earlier content-script instance.
  shifts.forEach((state, row) => {
    if (!row.isConnected) shifts.delete(row);
    else if (!touched.has(row)) clearShift(row, state);
  });
  doc.querySelectorAll(`tr[${SHIFT_ATTR}]`).forEach((el) => {
    if (!shifts.has(el as HTMLTableRowElement)) clearShift(el as HTMLTableRowElement, null);
  });
  // Watch every row of each tbody that is currently displaced (unshifted rows' heights matter too).
  const watch = new Set<HTMLTableRowElement>();
  const sortedBodies = new Set([...shifts.keys()].map((row) => rowTbody(row)).filter((b): b is HTMLTableSectionElement => !!b));
  sortedBodies.forEach((body) => visibleTableRows(body).forEach((row) => watch.add(row)));
  watchRowSizes(watch);
  liftHeaders(new Set([...sortedBodies].map((b) => b.closest('table')).filter((t): t is HTMLTableElement => !!t)), doc);
}

// ---------------------------------------------------------------------------
// Guards (called from the MutationObservers in content.ts)
// ---------------------------------------------------------------------------

// Human: Re-apply marks/shifts Ember wiped by rewriting class/style, and drop marks on recycled rows.
// Agent: CHEAP — iterates only rows we painted. WRITES only when something differs.
export function restorePaintedRows(): void {
  if (disposed) return;
  if (!marks.size && !shifts.size && !document.querySelector(`th[${LIFT_ATTR}]`)) return;
  marks.forEach((state, row) => {
    if (!row.isConnected || rowKey(row) !== state.key) {
      removeMark(row, state.cell);
      marks.delete(row);
      return;
    }
    if (state.cell && !state.cell.isConnected) state.cell = null;
    applyMark(row, state);
  });
  shifts.forEach((state, row) => {
    if (!row.isConnected) shifts.delete(row);
    else applyShift(row, state);
  });
  document.querySelectorAll(`th[${LIFT_ATTR}]`).forEach((el) => {
    const th = el as HTMLElement;
    if (th.style.zIndex !== '1') th.style.zIndex = '1';
  });
}

// Human: Rows added to / removed from a visually sorted tbody, or a row recycled for another ticket (its
// link swapped in place), make the offsets wrong: rows would overlap, leave gaps, or show a new page in the
// old page's order. Snap that tbody back to Freshservice's order at once; the queued repaint re-sorts it.
// Agent: READS childList + href attribute records. WRITES position/top only on rows we shifted.
export function dropShiftsOnStructureChange(records: MutationRecord[]): void {
  if (!shifts.size) return;
  const bodies = new Set<Node>();
  records.forEach((m) => {
    if (m.type === 'childList' && m.target instanceof HTMLTableSectionElement) {
      const rowNodes = [...m.addedNodes, ...m.removedNodes].some((n) => n instanceof HTMLTableRowElement);
      if (rowNodes) bodies.add(m.target);
      return;
    }
    if (m.type === 'attributes' && m.attributeName === 'href' && m.target instanceof Element) {
      const body = m.target.closest('tbody tr.et-tr')?.parentElement;
      if (body) bodies.add(body);
    }
  });
  if (!bodies.size) return;
  let snapped = false;
  shifts.forEach((state, row) => {
    const body = rowTbody(row);
    if (!row.isConnected || (body && bodies.has(body))) {
      clearShift(row, state);
      snapped = true;
    }
  });
  if (snapped) noteSnapBack();
}

/** Attribute records worth a restore: class/style/href changes inside a row we painted or a lifted header. */
export function recordsTouchPaintedRows(records: MutationRecord[]): boolean {
  if (!marks.size && !shifts.size && !document.querySelector(`th[${LIFT_ATTR}]`)) return false;
  return records.some((m) => {
    const target = m.target instanceof Element ? m.target : null;
    if (target?.closest(`th[${LIFT_ATTR}]`)) return true;
    const row = target?.closest('tr');
    return !!row && (marks.has(row as HTMLTableRowElement) || shifts.has(row as HTMLTableRowElement));
  });
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

export async function paintList(doc: Document = document, force = false): Promise<void> {
  if (disposed) return;
  const gen = ++paintGen;
  const scraped = collectRows(doc);
  const enrich = await enrichList(scraped, force);
  if (gen !== paintGen || disposed) return;
  const items = enrich.items;
  const moduleId = getModuleId();
  const cfg = page();
  const matches = items.flatMap((item) => {
    const rule = firstMatchingFilter(item, cfg, moduleId);
    return rule ? [{ item, rule }] : [];
  });
  // Rows Freshservice recycled while enrich was in flight now show another ticket. Do not paint the old
  // ticket's result onto them; the list observer has already queued the repaint that covers them.
  const live = items.filter((item) => item.row.isConnected && rowKey(item.row) === (item.href || ''));
  const liveRows = new Set(live.map((item) => item.row));
  // Start column first so a start-date rule can outline the injected cell.
  injectStartColumn(live, doc);
  const hits: RowHit[] = matches
    .filter(({ item }) => liveRows.has(item.row))
    .map(({ item, rule }) => ({
      item,
      color: rule.color,
      cell: emphasisCell(item.row, passingCriteria(item, rule, moduleId), idleExplainingCell(item.row, item.fromApi, item.cell)),
    }));
  syncRowMarks(hits, cfg.enabled, doc);
  setLastStats({
    tickets: items.length,
    marked: matches.length,
    extraMarked: enrich.extraMarked,
    fromApi: enrich.fromApi,
  });
  const visibleUrls = matches.map((x) => x.item.href).filter((u): u is string => !!u);
  setLastMarkedUrls([...new Set([...visibleUrls, ...enrich.extraUrls])]);
  setLastReportables(enrich.reportables.length ? enrich.reportables : items, {
    truncated: enrich.truncated,
    fromApi: enrich.fromApi,
  });
  applyVisualOrder(live, doc);
  runtime.renderStats();
}

// Human: Stop this instance from touching the page. A re-injected content script owns the table now and
// sweeps our leftover classes / offsets / lifted headers on its first paint.
// Agent: Disconnects the ResizeObserver and makes every paint entry point a no-op. Called via __sthTeardown.
export function disposePaint(): void {
  disposed = true;
  paintGen += 1;
  sizeObserver?.disconnect();
  sizeObserver = null;
  watchedRows = new Set();
  lastOrderItems = [];
  marks.clear();
  shifts.clear();
}

export function markTickets(opts: { force?: boolean } = {}): void {
  setModuleId(detectModule(getSettings().module));
  void paintList(document, !!opts.force);
}

export function openMarked(): void {
  void (async () => {
    setModuleId(detectModule(getSettings().module));
    await paintList(document, false);
    const urls = getLastMarkedUrls();
    if (!urls.length) return;
    if (urls.length > 8 && !confirm(`Open ${urls.length} marked items in new tabs?`)) return;
    let opened = 0;
    urls.forEach((url) => {
      if (window.open(url, '_blank', 'noopener')) opened += 1;
    });
    if (opened < urls.length) alert(`Opened ${opened} of ${urls.length} tabs. Allow pop-ups for this site.`);
  })();
}
