import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectRows } from '../lib/rows';
import { setModuleId } from '../lib/state';
import { injectStartColumn, invalidateStaleStartCells } from './start-column';

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

function journeyRow(id: string, withSubject = true): string {
  const subject = withSubject
    ? `<td data-name="subject"><a class="subject-cell" href="/a/employee_onboarding/${id}" title="Onboarding Start 14-09-2026">J ${id}</a></td>`
    : `<td data-name="other"><a class="subject-cell" href="/a/employee_onboarding/${id}">J ${id}</a></td>`;
  return `<tr class="et-tr" id="j${id}"><td data-name="isSelected"></td>${subject}<td data-name="status">Open</td></tr>`;
}

function list(rows: string): void {
  document.body.innerHTML = `<table>
    <thead><tr><th data-name="isSelected"></th><th data-name="subject">Subject</th><th data-name="status">Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function cellNames(row: Element): string[] {
  return [...row.children].map((c) => c.getAttribute('data-sth-col') || c.getAttribute('data-name') || '?');
}

describe('injectStartColumn', () => {
  beforeEach(() => setModuleId('journeys'));
  afterEach(() => {
    setModuleId('tickets');
    document.body.innerHTML = '';
  });

  it('adds one header and one cell per row right after Subject', () => {
    list(journeyRow('1'));
    injectStartColumn(collectRows(document));
    expect(cellNames(document.querySelector('thead tr') as Element)).toEqual(['isSelected', 'subject', 'start', 'status']);
    expect(cellNames(document.getElementById('j1') as Element)).toEqual(['isSelected', 'subject', 'start', 'status']);
    expect(document.querySelector('td[data-sth-col="start"]')?.textContent).toContain('14');
  });

  it('aligns rows without a subject td by the header column index', () => {
    list(journeyRow('1') + journeyRow('2', false));
    injectStartColumn(collectRows(document));
    expect(cellNames(document.getElementById('j2') as Element)).toEqual(['isSelected', 'other', 'start', 'status']);
  });

  it('removes the whole column when Subject is hidden, instead of leaving it misaligned', () => {
    list(journeyRow('1'));
    injectStartColumn(collectRows(document));
    document.querySelector('thead th[data-name="subject"]')?.remove();
    document.querySelector('td[data-name="subject"]')?.remove();
    injectStartColumn(collectRows(document));
    expect(document.querySelector('[data-sth-col="start"]')).toBeNull();
  });

  it('follows Subject when Freshservice reorders columns', () => {
    list(journeyRow('1'));
    injectStartColumn(collectRows(document));
    const headRow = document.querySelector('thead tr') as HTMLTableRowElement;
    headRow.appendChild(headRow.querySelector('th[data-name="subject"]') as Element);
    const row = document.getElementById('j1') as HTMLTableRowElement;
    row.appendChild(row.querySelector('td[data-name="subject"]') as Element);
    injectStartColumn(collectRows(document));
    expect(cellNames(headRow)).toEqual(['isSelected', 'status', 'subject', 'start']);
    expect(cellNames(row)).toEqual(['isSelected', 'status', 'subject', 'start']);
  });
});

describe('invalidateStaleStartCells', () => {
  beforeEach(() => setModuleId('journeys'));
  afterEach(() => {
    setModuleId('tickets');
    document.body.innerHTML = '';
  });

  it('blanks the Start cell of a row that now shows another journey', () => {
    list(journeyRow('1'));
    injectStartColumn(collectRows(document));
    const td = document.querySelector('td[data-sth-col="start"]') as HTMLTableCellElement;
    invalidateStaleStartCells(document);
    expect(td.textContent).toContain('14');
    (document.querySelector('a.subject-cell') as HTMLAnchorElement).setAttribute('href', '/a/employee_onboarding/9');
    invalidateStaleStartCells(document);
    expect(td.textContent).toBe('—');
    expect(td.dataset.startKey).toBeUndefined();
  });
});
