// Human: Highlight matching rows, inject the start column, and reorder the visible table page.
// Agent: WRITES row/cell CSS classes and tbody child order. CALLS runtime.renderStats after each pass.

import { CELL_MARK, ROW_MARK } from '../lib/constants';
import { detectModule } from '../lib/detect';
import { itemMatches } from '../lib/match';
import { collectRows, rowTbody } from '../lib/rows';
import { compareItems } from '../lib/sort';
import { getSettings, page, setLastStats, setModuleId } from '../lib/state';
import type { RowItem, SortKey } from '../lib/types';
import { runtime } from './runtime';
import { injectStartColumn } from './start-column';

export function clearMarks(doc: Document = document): void {
  doc.querySelectorAll(`.${ROW_MARK}`).forEach((el) => {
    el.classList.remove(ROW_MARK);
    el.removeAttribute('data-stale-days');
  });
  doc.querySelectorAll(`.${CELL_MARK}`).forEach((el) => el.classList.remove(CELL_MARK));
}

export function sortTableRows(items: RowItem[]): void {
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
  groups.forEach((list, body) => {
    list.sort((a, b) => compareItems(a, b, key, dir));
    const occ = [...body.querySelectorAll('occluded-content')];
    list.forEach((item) => body.appendChild(item.row));
    occ.forEach((el) => body.appendChild(el));
  });
}

export function paintList(doc: Document = document): void {
  clearMarks(doc);
  const items = collectRows(doc);
  const hits = items.filter((item) => itemMatches(item, page()));
  if (page().enabled) {
    hits.forEach((item) => {
      item.row.classList.add(ROW_MARK);
      if (item.idleDays != null) item.row.dataset.staleDays = String(Math.floor(item.idleDays));
      if (item.cell) item.cell.classList.add(CELL_MARK);
    });
  }
  setLastStats({ tickets: items.length, marked: hits.length });
  injectStartColumn(items, doc);
  sortTableRows(items);
  runtime.renderStats();
}

export function markTickets(): void {
  setModuleId(detectModule(getSettings().module));
  paintList();
}

export function openMarked(): void {
  markTickets();
  const urls = [...new Set(collectRows().filter((x) => itemMatches(x, page())).map((x) => x.href).filter((u): u is string => !!u))];
  if (!urls.length) return;
  if (urls.length > 8 && !confirm(`Open ${urls.length} marked items in new tabs?`)) return;
  let opened = 0;
  urls.forEach((url) => {
    if (window.open(url, '_blank', 'noopener')) opened += 1;
  });
  if (opened < urls.length) alert(`Opened ${opened} of ${urls.length} tabs. Allow pop-ups for this site.`);
}
