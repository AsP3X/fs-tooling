// Human: Inject a Start date column after Subject on Journeys lists; values come from the request title / API.
// Agent: WRITES thead/td[data-sth-col=start]. Range badge is inert without an API key; it does not hide live rows.

import { formatStart, prettyStart } from '../lib/dates';
import { formatRangeLabel, rangeActive, rangeListingEnabled } from '../lib/range';
import { getModuleId, hasApiKeyPresent, page } from '../lib/state';
import { escapeHtml } from '../lib/text';
import type { RowItem } from '../lib/types';

export function removeStartColumn(doc: Document = document): void {
  doc.querySelectorAll('[data-sth-col="start"]').forEach((el) => el.remove());
}

// Human: Refresh the Range badge without touching row cells or the live table body.
// Agent: WRITES th[data-sth-col=start] innerHTML/classes only.
export function syncStartColumnHeader(doc: Document = document): void {
  const th = doc.querySelector('thead th[data-sth-col="start"]');
  if (!th) return;
  const cfg = page();
  const on = cfg.sortKey === 'start';
  const canRange = rangeListingEnabled(hasApiKeyPresent());
  const ranged = canRange && rangeActive(cfg.startFrom, cfg.startTo);
  const rangeText = formatRangeLabel(cfg.startFrom, cfg.startTo);
  th.classList.toggle('sth-on', on);
  th.classList.toggle('sth-filtered', ranged);
  th.classList.toggle('sth-range-off', !canRange);
  const badge = canRange ? (ranged ? escapeHtml(rangeText) : 'Range') : 'Range';
  th.innerHTML = `Start date<span class="sth-sort">${on ? (cfg.sortDir === 'desc' ? '↓' : '↑') : '↕'}</span><button type="button" class="sth-range-badge" ${canRange ? '' : 'disabled'}>${badge}</button>`;
  (th as HTMLElement).title = !canRange
    ? 'Click to sort · Date range needs an API key in Settings'
    : ranged
      ? `${rangeText} listed in the ops panel. Click to sort · Range opens our table (this list is unchanged)`
      : 'Click to sort · Set From/To in the panel and click Apply';
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
  syncStartColumnHeader(doc);
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
      ? `<span title="Start ${formatStart(item.startKey)}${rangeListingEnabled(hasApiKeyPresent()) ? ' · Right-click to set this day, then Apply' : ''}">${label}</span>`
      : '<span class="sth-empty">—</span>';
  });
}
