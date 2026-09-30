import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELL_MARK, ROW_MARK } from '../lib/constants';
import { collectRows } from '../lib/rows';
import { assignRoot, getModuleId, getSettings, setModuleId } from '../lib/state';
import type { FilterRule, PageSettings, RowItem } from '../lib/types';
import {
  applyVisualOrder,
  dropShiftsOnStructureChange,
  paintList,
  recordsTouchPaintedRows,
  restorePaintedRows,
  SORT_PAUSED_NOTICE,
  syncRowMarks,
  visualSortActive,
} from './paint';
import { runtime } from './runtime';

// Agent: Node 25 exposes a throwing global localStorage that shadows jsdom's; settings only need memory here.
const mem = new Map<string, string>();
const memStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};
vi.stubGlobal('localStorage', memStorage);

function setPage(partial: Partial<PageSettings>): void {
  const s = getSettings();
  const id = getModuleId();
  assignRoot({ [id]: { ...s[id], ...partial } });
}

function rule(partial: Partial<FilterRule>): FilterRule {
  return { id: 'r', name: 'r', builtin: false, enabled: true, color: '#c62828', matchMode: 'or', invert: false, criteria: {}, ...partial };
}

function row(partial: Partial<RowItem> & { row: HTMLTableRowElement }): RowItem {
  return {
    cell: null,
    href: null,
    status: 'Open',
    idleDays: 10,
    created: null,
    updated: null,
    start: null,
    startIn: null,
    kind: '—',
    progress: { pct: null, done: null, total: null },
    startKey: null,
    updatedKey: null,
    initiator: '',
    ord: 0,
    label: '',
    recordId: null,
    fromApi: false,
    subject: '',
    createdDays: null,
    dueIn: null,
    priority: null,
    unassigned: null,
    escalated: null,
    ...partial,
  };
}

/** Freshservice-like list row. `updated` far in the past makes it idle. */
function tr(id: string, opts: { updated?: string; status?: string; priority?: string } = {}): string {
  return `<tr class="et-tr ember-view" id="r${id}">
    <td data-name="isSelected" class="is-fixed-left"></td>
    <td data-name="ticket_subject"><a class="subject-cell" href="/a/tickets/${id}">T ${id}</a></td>
    <td data-name="updated_at_date"><div class="ellipsis" data-test-id="date-cell" title="${opts.updated || '01 Jan, 2020 09:00'}">x</div></td>
    <td data-name="status"><span class="status-result" title="${opts.status || 'Open'}">${opts.status || 'Open'}</span></td>
    <td data-name="priority" title="${opts.priority || 'Low'}"><span>${opts.priority || 'Low'}</span></td>
  </tr>`;
}

/** jsdom has no layout; give rows fixed 40px boxes (or `heights`) stacked in DOM order inside a tbody at y=0. */
function fakeLayout(rows: HTMLTableRowElement[], heights: number[] = []): void {
  const rect = (top: number, height: number): DOMRect => ({
    top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}),
  } as DOMRect);
  const body = rows[0]?.parentElement;
  if (body) Object.defineProperty(body, 'getBoundingClientRect', { configurable: true, value: () => rect(0, 0) });
  rows.forEach((r, i) => {
    Object.defineProperty(r, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const siblings = [...(r.parentElement?.children || [])].filter((el) => rows.includes(el as HTMLTableRowElement));
        const idx = siblings.indexOf(r);
        let top = 0;
        for (let k = 0; k < idx; k += 1) top += heights[rows.indexOf(siblings[k] as HTMLTableRowElement)] ?? 40;
        // Like browsers, the rect includes a relative `top` offset.
        const shift = r.style.position === 'relative' ? parseFloat(r.style.top) || 0 : 0;
        return rect(top + shift, heights[i] ?? 40);
      },
    });
  });
}

beforeEach(() => {
  setModuleId('tickets');
  setPage({ enabled: true, sortKey: 'default', sortDir: 'asc', filters: [] });
});

afterEach(() => {
  // Reset module state (marks/shifts) through the public API, then the DOM.
  syncRowMarks([], true, document);
  setPage({ sortKey: 'default' });
  applyVisualOrder(collectRows(document), document);
  document.body.innerHTML = '';
});

describe('syncRowMarks', () => {
  it('does not remove the class from a row that is still a hit', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr sth-row" id="a"></tr><tr class="et-tr sth-row" id="b"></tr></tbody></table>';
    const a = document.getElementById('a') as HTMLTableRowElement;
    const b = document.getElementById('b') as HTMLTableRowElement;
    syncRowMarks([{ item: row({ row: a }), color: '#e65100' }], true, document);
    expect(a.classList.contains(ROW_MARK)).toBe(true);
    expect(b.classList.contains(ROW_MARK)).toBe(false);
  });

  it('clears leftover cell marks when highlighting is off', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr"><td class="sth-cell" id="c"></td></tr></tbody></table>';
    const td = document.getElementById('c') as HTMLTableCellElement;
    const tr = td.parentElement as HTMLTableRowElement;
    tr.classList.add(ROW_MARK);
    syncRowMarks([{ item: row({ row: tr, cell: td }), color: '#e65100' }], false, document);
    expect(tr.classList.contains(ROW_MARK)).toBe(false);
    expect(td.classList.contains(CELL_MARK)).toBe(false);
  });

  it('moves the outline when the explaining cell changes', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr" id="a"><td id="x"></td><td id="y"></td></tr></tbody></table>';
    const a = document.getElementById('a') as HTMLTableRowElement;
    const x = document.getElementById('x') as HTMLElement;
    const y = document.getElementById('y') as HTMLElement;
    syncRowMarks([{ item: row({ row: a }), color: '#e65100', cell: x }], true, document);
    syncRowMarks([{ item: row({ row: a }), color: '#e65100', cell: y }], true, document);
    expect(x.classList.contains(CELL_MARK)).toBe(false);
    expect(y.classList.contains(CELL_MARK)).toBe(true);
  });
});

describe('restorePaintedRows', () => {
  it('re-applies a mark after Ember rewrites the class attribute', () => {
    document.body.innerHTML = `<table><tbody>${tr('1')}</tbody></table>`;
    const r = document.getElementById('r1') as HTMLTableRowElement;
    syncRowMarks([{ item: row({ row: r, href: `${location.origin}/a/tickets/1` }), color: '#c62828' }], true, document);
    r.setAttribute('class', 'et-tr ember-view is-selected');
    r.removeAttribute('style');
    restorePaintedRows();
    expect(r.classList.contains(ROW_MARK)).toBe(true);
    expect(r.classList.contains('is-selected')).toBe(true);
    expect(r.style.getPropertyValue('--sth-mark')).toBe('#c62828');
  });

  it('drops the mark when a recycled row now shows another ticket', () => {
    document.body.innerHTML = `<table><tbody>${tr('1')}</tbody></table>`;
    const r = document.getElementById('r1') as HTMLTableRowElement;
    const date = r.querySelector('[data-test-id="date-cell"]') as HTMLElement;
    syncRowMarks([{ item: row({ row: r, href: `${location.origin}/a/tickets/1`, cell: date }), color: '#c62828' }], true, document);
    (r.querySelector('a') as HTMLAnchorElement).setAttribute('href', '/a/tickets/99');
    restorePaintedRows();
    expect(r.classList.contains(ROW_MARK)).toBe(false);
    expect(r.hasAttribute('data-stale-days')).toBe(false);
    expect(date.classList.contains(CELL_MARK)).toBe(false);
  });

  it('only reacts to records inside painted rows', () => {
    document.body.innerHTML = `<table><tbody>${tr('1')}${tr('2')}</tbody></table>`;
    const r1 = document.getElementById('r1') as HTMLTableRowElement;
    const r2 = document.getElementById('r2') as HTMLTableRowElement;
    syncRowMarks([{ item: row({ row: r1 }), color: '#c62828' }], true, document);
    const rec = (target: Node) => ({ type: 'attributes', target } as unknown as MutationRecord);
    expect(recordsTouchPaintedRows([rec(r1)])).toBe(true);
    expect(recordsTouchPaintedRows([rec(r2)])).toBe(false);
  });
});

describe('applyVisualOrder', () => {
  function setup(): { body: HTMLTableSectionElement; rows: HTMLTableRowElement[] } {
    document.body.innerHTML = `<table><tbody>${tr('1', { status: 'Alpha' })}${tr('2', { status: 'Beta' })}${tr('3', { status: 'Gamma' })}</tbody></table>`;
    const body = document.querySelector('tbody') as HTMLTableSectionElement;
    const rows = [...body.querySelectorAll('tr')] as HTMLTableRowElement[];
    fakeLayout(rows);
    return { body, rows };
  }

  it('offsets rows instead of moving them, so Freshservice DOM order is untouched', () => {
    const { body, rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    expect([...body.children]).toEqual(rows);
    expect(rows.map((r) => r.style.top)).toEqual(['80px', '', '-80px']);
    expect(rows[0].style.position).toBe('relative');
    expect(rows[1].hasAttribute('data-sth-shift')).toBe(false);
    expect(visualSortActive()).toBe(true);
  });

  it('re-measures a sorted table to the same offsets (no drift on reflow)', () => {
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    applyVisualOrder(collectRows(document), document);
    expect(rows.map((r) => r.style.top)).toEqual(['80px', '', '-80px']);
  });

  it('clears offsets for Default sort', () => {
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    setPage({ sortKey: 'default' });
    applyVisualOrder(collectRows(document), document);
    expect(rows.every((r) => r.style.top === '' && r.style.position === '')).toBe(true);
    expect(visualSortActive()).toBe(false);
  });

  it('does not sort while ember-table occlusion renders only part of the list', () => {
    const { rows } = setup();
    // Real markup: spacers are siblings of the <table> inside .ember-table-overflow.
    const table = document.querySelector('table') as HTMLTableElement;
    const overflow = document.createElement('div');
    overflow.className = 'ember-table-overflow';
    overflow.innerHTML = '<occluded-content style="height: 120px;"></occluded-content>';
    table.before(overflow);
    overflow.appendChild(table);
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    expect(rows.every((r) => r.style.top === '')).toBe(true);
  });

  it('keeps default order stable when rows appear after a visual sort', () => {
    const { body } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    // A new first ticket arrives; Glimmer inserts it at the front of its (DOM) order.
    body.insertAdjacentHTML('afterbegin', tr('0', { status: 'Zulu' }));
    const items = collectRows(document);
    expect(items.map((i) => `${i.row.id}:${i.ord}`)).toEqual(['r0:0', 'r1:1', 'r2:2', 'r3:3']);
  });

  it('snaps a sorted tbody back when rows are added or removed', () => {
    const { body, rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    const removed = rows[1];
    removed.remove();
    dropShiftsOnStructureChange([{ type: 'childList', target: body, addedNodes: [] as unknown as NodeList, removedNodes: [removed] as unknown as NodeList } as unknown as MutationRecord]);
    expect(rows[0].style.top).toBe('');
    expect(rows[2].style.top).toBe('');
  });

  it('does not restore offsets left by an earlier instance as if they were Freshservice styles', () => {
    const { rows } = setup();
    rows[1].setAttribute('data-sth-shift', '');
    rows[1].style.position = 'relative';
    rows[1].style.top = '999px';
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    // The stale 999px is measured as an applied offset, not as the row's natural position.
    expect(rows.map((r) => r.style.top)).toEqual(['80px', '', '-80px']);
    setPage({ sortKey: 'default' });
    applyVisualOrder(collectRows(document), document);
    expect(rows.every((r) => r.style.top === '' && r.style.position === '' && !r.hasAttribute('data-sth-shift'))).toBe(true);
  });

  it('re-lifts a header cell after Ember rewrites its style, and lifts z-index 0', () => {
    const { rows } = setup();
    document.querySelector('table')?.insertAdjacentHTML('afterbegin', '<thead><tr><th id="h1">A</th><th id="h0" style="z-index: 0">B</th></tr></thead>');
    fakeLayout(rows);
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    const h1 = document.getElementById('h1') as HTMLElement;
    const h0 = document.getElementById('h0') as HTMLElement;
    expect(h0.style.zIndex).toBe('1');
    h1.setAttribute('style', 'width: 90px');
    expect(recordsTouchPaintedRows([{ type: 'attributes', target: h1 } as unknown as MutationRecord])).toBe(true);
    restorePaintedRows();
    expect(h1.style.zIndex).toBe('1');
    setPage({ sortKey: 'default' });
    applyVisualOrder(collectRows(document), document);
    expect(h0.style.zIndex).toBe('0');
    expect(h1.style.zIndex).toBe('');
  });

  it('lifts auto z-index header cells above shifted rows only while sorted', () => {
    const { rows } = setup();
    document.querySelector('table')?.insertAdjacentHTML('afterbegin', '<thead><tr><th id="h1">A</th><th id="h2" style="z-index: 5">B</th></tr></thead>');
    fakeLayout(rows);
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    const h1 = document.getElementById('h1') as HTMLElement;
    const h2 = document.getElementById('h2') as HTMLElement;
    expect(h1.style.zIndex).toBe('1');
    expect(h2.style.zIndex).toBe('5');
    expect(h2.hasAttribute('data-sth-z')).toBe(false);
    setPage({ sortKey: 'default' });
    applyVisualOrder(collectRows(document), document);
    expect(h1.style.zIndex).toBe('');
    expect(h1.hasAttribute('data-sth-z')).toBe(false);
  });

  it('leaves a sorted tbody alone when the item set does not cover every row', () => {
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    applyVisualOrder(collectRows(document).slice(1), document);
    expect(rows[0].style.top).toBe('80px');
  });

  it('still clears for Default when a row is skipped', () => {
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    setPage({ sortKey: 'default' });
    applyVisualOrder(collectRows(document).slice(1), document);
    expect(rows.every((r) => r.style.top === '')).toBe(true);
  });

  it('does not sort a tbody with a hidden row or a foreign visible child', () => {
    const { rows } = setup();
    fakeLayout(rows, [40, 0, 40]);
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    expect(rows.every((r) => r.style.top === '')).toBe(true);
    fakeLayout(rows);
    const extra = document.createElement('tr');
    extra.className = 'expansion';
    Object.defineProperty(extra, 'getBoundingClientRect', { value: () => ({ top: 40, height: 30 }) });
    rows[0].after(extra);
    applyVisualOrder(collectRows(document), document);
    expect(rows.every((r) => r.style.top === '')).toBe(true);
  });

  it('snaps back when a row is recycled by an href swap', () => {
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    const link = rows[2].querySelector('a') as HTMLAnchorElement;
    link.setAttribute('href', '/a/tickets/77');
    dropShiftsOnStructureChange([{ type: 'attributes', attributeName: 'href', target: link } as unknown as MutationRecord]);
    expect(rows.every((r) => r.style.top === '')).toBe(true);
  });

  it('ignores attribute records other than href', () => {
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    dropShiftsOnStructureChange([{ type: 'attributes', attributeName: 'class', target: rows[0] } as unknown as MutationRecord]);
    expect(rows[0].style.top).toBe('80px');
  });

  it('re-applies an offset Ember wiped by rewriting the style attribute', () => {
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    rows[0].setAttribute('style', '');
    restorePaintedRows();
    expect(rows[0].style.top).toBe('80px');
    expect(rows[0].style.position).toBe('relative');
  });

  it('pauses the sort after repeated snap-backs and resumes for another sort key', () => {
    const { body, rows } = setup();
    const notices: string[] = [];
    runtime.notify = (m) => notices.push(m);
    setPage({ sortKey: 'status', sortDir: 'desc' });
    const rec = { type: 'childList', target: body, addedNodes: [rows[0]], removedNodes: [] } as unknown as MutationRecord;
    for (let i = 0; i < 4; i += 1) {
      applyVisualOrder(collectRows(document), document);
      dropShiftsOnStructureChange([rec]);
    }
    expect(notices).toEqual([SORT_PAUSED_NOTICE]);
    applyVisualOrder(collectRows(document), document);
    expect(rows.every((r) => r.style.top === '')).toBe(true);
    setPage({ sortKey: 'status', sortDir: 'asc' });
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    expect(rows[0].style.top).toBe('');
    setPage({ sortKey: 'status', sortDir: 'asc' });
    applyVisualOrder(collectRows(document), document);
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    expect(rows[0].style.top).toBe('80px');
    runtime.notify = () => {};
  });

  it('re-measures when a row changes height (ResizeObserver path)', async () => {
    let fire: (() => void) | null = null;
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { fire = cb; }
      observe(): void {}
      disconnect(): void {}
    });
    const { rows } = setup();
    setPage({ sortKey: 'status', sortDir: 'desc' });
    applyVisualOrder(collectRows(document), document);
    expect(rows[0].style.top).toBe('80px');
    fakeLayout(rows, [40, 60, 40]);
    (fire as unknown as () => void)();
    await new Promise((r) => setTimeout(r, 40));
    // r1 grew to 60px: r2 → 0, r1 stays at 40, r0 → 100 (was 80 before the resize).
    expect(rows.map((r) => r.style.top)).toEqual(['100px', '', '-100px']);
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', memStorage);
  });
});

describe('paintList', () => {
  it('outlines the Priority cell for a priority rule, not the Updated date', async () => {
    setPage({ filters: [rule({ criteria: { priorityPattern: 'urgent' } })] });
    document.body.innerHTML = `<table><tbody>${tr('1', { updated: '30 Sep, 2026 09:00', priority: 'Urgent' })}</tbody></table>`;
    await paintList(document);
    const outlined = document.querySelector(`.${CELL_MARK}`);
    expect(document.querySelector(`tr.${ROW_MARK}`)).not.toBeNull();
    expect(outlined?.closest('td')?.getAttribute('data-name')).toBe('priority');
  });

  it('outlines the Status cell when idle days came from "since N days" on the status control', async () => {
    setPage({ filters: [rule({ criteria: { idleDays: 3 } })] });
    document.body.innerHTML = `<table><tbody>${tr('1', { updated: '30 Sep, 2026 09:00' })}</tbody></table>`;
    const status = document.querySelector('td[data-name="status"]') as HTMLElement;
    status.insertAdjacentHTML('beforeend', '<div class="status-list-trigger" aria-label="Open since 12 days"></div>');
    await paintList(document);
    expect(document.querySelector(`.${CELL_MARK}`)?.closest('td')?.getAttribute('data-name')).toBe('status');
  });

  it('keeps outlining the Updated date for idle rules', async () => {
    setPage({ filters: [rule({ matchMode: 'and', criteria: { idleDays: 3, statusPattern: 'open' } })] });
    document.body.innerHTML = `<table><tbody>${tr('1')}</tbody></table>`;
    await paintList(document);
    expect(document.querySelector(`.${CELL_MARK}`)?.getAttribute('data-test-id')).toBe('date-cell');
  });

  it('does not paint a row that was recycled for another ticket while enrich was running', async () => {
    setPage({ filters: [rule({ criteria: { idleDays: 3 } })] });
    document.body.innerHTML = `<table><tbody>${tr('1')}</tbody></table>`;
    const r = document.getElementById('r1') as HTMLTableRowElement;
    const pending = paintList(document);
    // Recycled before the awaited enrich resolves.
    (r.querySelector('a') as HTMLAnchorElement).setAttribute('href', '/a/tickets/77');
    await pending;
    expect(r.classList.contains(ROW_MARK)).toBe(false);
  });
});

describe('disposePaint', () => {
  it('turns every paint entry point into a no-op for the replaced instance', async () => {
    // Fresh module instance so disposing it does not disable the shared one used above.
    vi.resetModules();
    const fresh = await import('./paint');
    const state = await import('../lib/state');
    state.setModuleId('tickets');
    const s = state.getSettings();
    state.assignRoot({ tickets: { ...s.tickets, enabled: true, sortKey: 'status', sortDir: 'desc', filters: [rule({ criteria: { idleDays: 3 } })] } });
    document.body.innerHTML = `<table><tbody>${tr('1', { status: 'A' })}${tr('2', { status: 'B' })}</tbody></table>`;
    fakeLayout([...document.querySelectorAll('tbody tr')] as HTMLTableRowElement[]);
    fresh.disposePaint();
    await fresh.paintList(document);
    fresh.applyVisualOrder(collectRows(document), document);
    expect(document.querySelector('tr.sth-row')).toBeNull();
    expect(document.querySelector('tr[data-sth-shift]')).toBeNull();
    expect(fresh.visualSortActive()).toBe(false);
  });
});
