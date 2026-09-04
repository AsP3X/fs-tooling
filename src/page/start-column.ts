// Human: Inject a Start date column after Subject on Journeys lists; values come from the request title / API.
// Agent: WRITES thead/td[data-sth-col=start] only when the text/classes change, so the list observer does not loop.

import { formatStart, prettyStart } from '../lib/dates';
import { formatRangeLabel, rangeActive, rangeListingEnabled } from '../lib/range';
import { getModuleId, hasApiKeyPresent, page } from '../lib/state';
import { escapeHtml } from '../lib/text';
import type { RowItem } from '../lib/types';

export function removeStartColumn(doc: Document = document): void {
  doc.querySelectorAll('[data-sth-col="start"]').forEach((el) => el.remove());
}

function setText(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

// Human: Refresh the Range badge without touching row cells or the live table body.
// Agent: WRITES th[data-sth-col=start] classes/text only when they differ.
export function syncStartColumnHeader(doc: Document = document): void {
  const th = doc.querySelector('thead th[data-sth-col="start"]') as HTMLElement | null;
  if (!th) return;
  const cfg = page();
  const on = cfg.sortKey === 'start';
  const canRange = rangeListingEnabled(hasApiKeyPresent());
  const ranged = canRange && rangeActive(cfg.startFrom, cfg.startTo);
  const rangeText = formatRangeLabel(cfg.startFrom, cfg.startTo);
  th.classList.toggle('sth-on', on);
  th.classList.toggle('sth-filtered', ranged);
  th.classList.toggle('sth-range-off', !canRange);
  let sortEl = th.querySelector('.sth-sort') as HTMLElement | null;
  let badge = th.querySelector('.sth-range-badge') as HTMLButtonElement | null;
  if (!sortEl || !badge) {
    th.innerHTML = 'Start date<span class="sth-sort"></span><button type="button" class="sth-range-badge"></button>';
    sortEl = th.querySelector('.sth-sort') as HTMLElement;
    badge = th.querySelector('.sth-range-badge') as HTMLButtonElement;
  }
  setText(sortEl, on ? (cfg.sortDir === 'desc' ? '↓' : '↑') : '↕');
  setText(badge, canRange && ranged ? rangeText : 'Range');
  badge.disabled = !canRange;
  const title = !canRange
    ? 'Click to sort · Date range needs an API key in Settings'
    : ranged
      ? `${rangeText} listed in the ops panel. Click to sort · Range opens our table (this list is unchanged)`
      : 'Click to sort · Set From/To in the panel and click Apply';
  if (th.title !== title) th.title = title;
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
  const canRange = rangeListingEnabled(hasApiKeyPresent());
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
    if (item.startKey) {
      if (td.dataset.startKey !== item.startKey) td.dataset.startKey = item.startKey;
    } else {
      delete td.dataset.startKey;
    }
    const label = prettyStart(item.start);
    if (!label) {
      if (td.querySelector('.sth-empty')) return;
      td.innerHTML = '<span class="sth-empty">—</span>';
      return;
    }
    const title = `Start ${formatStart(item.startKey)}${canRange ? ' · Right-click to set this day, then Apply' : ''}`;
    let span = td.querySelector('span:not(.sth-empty)') as HTMLElement | null;
    if (!span) {
      td.innerHTML = `<span>${escapeHtml(label)}</span>`;
      span = td.querySelector('span') as HTMLElement;
    } else {
      setText(span, label);
    }
    if (span.title !== title) span.title = title;
  });
}
