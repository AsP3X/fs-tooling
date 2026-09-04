import { afterEach, describe, expect, it } from 'vitest';
import { CELL_MARK, ROW_MARK } from '../lib/constants';
import type { RowItem } from '../lib/types';
import { syncRowMarks, tbodyNeedsReorder } from './paint';

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
    ...partial,
  };
}

describe('syncRowMarks', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not remove the class from a row that is still a hit', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr sth-row" id="a"></tr><tr class="et-tr sth-row" id="b"></tr></tbody></table>';
    const a = document.getElementById('a') as HTMLTableRowElement;
    const b = document.getElementById('b') as HTMLTableRowElement;
    syncRowMarks([row({ row: a })], true, document);
    expect(a.classList.contains(ROW_MARK)).toBe(true);
    expect(b.classList.contains(ROW_MARK)).toBe(false);
  });

  it('clears leftover cell marks when highlighting is off', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr"><td class="sth-cell" id="c"></td></tr></tbody></table>';
    const td = document.getElementById('c') as HTMLTableCellElement;
    const tr = td.parentElement as HTMLTableRowElement;
    tr.classList.add(ROW_MARK);
    syncRowMarks([row({ row: tr, cell: td })], false, document);
    expect(tr.classList.contains(ROW_MARK)).toBe(false);
    expect(td.classList.contains(CELL_MARK)).toBe(false);
  });
});

describe('tbodyNeedsReorder', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is false when rows already match the desired order', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr" id="a"></tr><tr class="et-tr" id="b"></tr></tbody></table>';
    const body = document.querySelector('tbody') as HTMLTableSectionElement;
    const a = document.getElementById('a') as HTMLTableRowElement;
    const b = document.getElementById('b') as HTMLTableRowElement;
    expect(tbodyNeedsReorder(body, [a, b])).toBe(false);
    expect(tbodyNeedsReorder(body, [b, a])).toBe(true);
  });
});
