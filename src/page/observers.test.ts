import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELL_MARK, ROW_MARK } from '../lib/constants';
import { collectRows } from '../lib/rows';
import { assignRoot, getSettings, setModuleId } from '../lib/state';
import type { FilterRule } from '../lib/types';
import { startListObservers, type ListObservers } from './observers';
import { applyVisualOrder, paintList, syncRowMarks } from './paint';

// Agent: Node 25 exposes a throwing global localStorage that shadows jsdom's; settings only need memory here.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
});

const rule: FilterRule = { id: 'r', name: 'r', builtin: false, enabled: true, color: '#c62828', matchMode: 'or', invert: false, criteria: { idleDays: 3 } };

function tr(id: string, status: string): string {
  return `<tr class="et-tr ember-view" id="r${id}">
    <td data-name="isSelected"></td>
    <td data-name="ticket_subject"><a class="subject-cell" href="/a/tickets/${id}">T ${id}</a></td>
    <td data-name="updated_at_date"><div data-test-id="date-cell" title="01 Jan, 2020 09:00">x</div></td>
    <td data-name="status"><span class="status-result" title="${status}">${status}</span></td>
  </tr>`;
}

function layout(rows: HTMLTableRowElement[]): void {
  const body = rows[0].parentElement as HTMLElement;
  Object.defineProperty(body, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, height: 0 }) });
  rows.forEach((r) => Object.defineProperty(r, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: 40 * rows.indexOf(r) + (r.style.position === 'relative' ? parseFloat(r.style.top) || 0 : 0),
      height: 40,
    }),
  }));
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('startListObservers', () => {
  let obs: ListObservers | null = null;
  let paints = 0;

  beforeEach(async () => {
    setModuleId('tickets');
    const s = getSettings();
    assignRoot({ tickets: { ...s.tickets, enabled: true, sortKey: 'status', sortDir: 'desc', filters: [rule] } });
    document.body.innerHTML = `<table><tbody>${tr('1', 'Alpha')}${tr('2', 'Beta')}${tr('3', 'Gamma')}</tbody></table>`;
    layout([...document.querySelectorAll('tbody tr')] as HTMLTableRowElement[]);
    await paintList(document);
    paints = 0;
    obs = startListObservers(document.body, null, () => { paints += 1; }, 10);
  });

  afterEach(() => {
    obs?.stop();
    syncRowMarks([], true, document);
    const s = getSettings();
    assignRoot({ tickets: { ...s.tickets, sortKey: 'default' } });
    applyVisualOrder(collectRows(document), document);
    document.body.innerHTML = '';
  });

  it('settles: our own restore writes never schedule a repaint', async () => {
    const r1 = document.getElementById('r1') as HTMLTableRowElement;
    expect(r1.classList.contains(ROW_MARK)).toBe(true);
    expect(r1.style.top).toBe('80px');
    r1.setAttribute('class', 'et-tr ember-view is-selected');
    r1.setAttribute('style', '');
    await tick(40);
    expect(r1.classList.contains(ROW_MARK)).toBe(true);
    expect(r1.style.top).toBe('80px');
    expect(paints).toBe(0);
  });

  it('drops marks and offsets on an href swap, then schedules one repaint', async () => {
    const r2 = document.getElementById('r2') as HTMLTableRowElement;
    const r1 = document.getElementById('r1') as HTMLTableRowElement;
    (r2.querySelector('a') as HTMLAnchorElement).setAttribute('href', '/a/tickets/99');
    await tick(0);
    expect(r2.classList.contains(ROW_MARK)).toBe(false);
    expect(r2.querySelector(`.${CELL_MARK}`)).toBeNull();
    expect(r1.style.top).toBe('');
    await tick(40);
    expect(paints).toBe(1);
  });

  it('snaps back and repaints when Freshservice adds a row', async () => {
    const body = document.querySelector('tbody') as HTMLTableSectionElement;
    body.insertAdjacentHTML('beforeend', tr('4', 'Delta'));
    await tick(0);
    expect(document.querySelector('tr[data-sth-shift]')).toBeNull();
    await tick(40);
    expect(paints).toBe(1);
  });

  it('stop() cancels a pending repaint', async () => {
    (document.querySelector('tbody') as HTMLElement).insertAdjacentHTML('beforeend', tr('5', 'Echo'));
    await tick(0);
    obs?.stop();
    await tick(40);
    expect(paints).toBe(0);
  });
});
