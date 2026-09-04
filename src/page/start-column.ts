// Human: Inject a Start date column after Subject on Journeys lists; values come from the request title.
// Agent: WRITES thead/td[data-sth-col=start]. No-op (and removes the column) on ticket lists.

import { formatStart, prettyStart } from '../lib/dates';
import { getModuleId, page } from '../lib/state';
import type { RowItem } from '../lib/types';

export function removeStartColumn(doc: Document = document): void {
  doc.querySelectorAll('[data-sth-col="start"]').forEach((el) => el.remove());
}

export function injectStartColumn(items: RowItem[], doc: Document = document): void {
  if (getModuleId() !== 'journeys') {
    removeStartColumn(doc);
    return;
  }
  const subjectTh = doc.querySelector('thead th[data-name="subject"]');
  if (!subjectTh) return;
  let th = doc.querySelector('thead th[data-sth-col="start"]');
  if (!th) {
    th = doc.createElement('th');
    th.setAttribute('data-sth-col', 'start');
    th.className = 'ember-view ellipsis is-resizable sth-start-header';
    th.setAttribute('role', 'columnheader');
    subjectTh.after(th);
  }
  const cfg = page();
  const on = cfg.sortKey === 'start';
  th.classList.toggle('sth-on', on);
  th.innerHTML = `Start date<span class="sth-sort">${on ? (cfg.sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>`;
  (th as HTMLElement).title = 'Sort by start date from the request title';
  items.forEach((item) => {
    const subjectTd = item.row.querySelector('td[data-name="subject"]');
    if (!subjectTd) return;
    let td = item.row.querySelector('td[data-sth-col="start"]') as HTMLTableCellElement | null;
    if (!td) {
      td = doc.createElement('td');
      td.dataset.sthCol = 'start';
      td.className = 'ember-view sth-start-cell';
      subjectTd.after(td);
    }
    if (item.startKey) td.dataset.startKey = item.startKey;
    else delete td.dataset.startKey;
    const label = prettyStart(item.start);
    td.innerHTML = label
      ? `<span title="Start ${formatStart(item.startKey)}">${label}</span>`
      : '<span class="sth-empty">—</span>';
  });
}
