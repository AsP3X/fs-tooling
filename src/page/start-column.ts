// Human: Inject a Start date column after Subject on Journeys lists; values come from the request title / API.
// Agent: WRITES thead/td[data-sth-col=start] only when the text/classes change, so the list observer does not loop.
// Cells carry data-sth-key (the row's ticket href) so recycled rows can be blanked before the next paint.

import { formatStart, prettyStart } from '../lib/dates';
import { formatRangeLabel, rangeActive, rangeListingEnabled } from '../lib/range';
import { rowKey } from '../lib/rows';
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

// Human: Give our header cell the same stacking and opaque background as its Freshservice neighbour, so
// rows do not show through it while the header is pinned and it layers like the other columns.
// Agent: READS getComputedStyle(subject th). WRITES inline background-color / z-index on our th only.
function syncHeaderChrome(th: HTMLElement, subjectTh: Element): void {
  const view = subjectTh.ownerDocument.defaultView;
  if (!view) return;
  const cs = view.getComputedStyle(subjectTh);
  const bg = cs.backgroundColor;
  const opaque = !!bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg);
  const wantBg = opaque ? bg : '';
  if (th.style.backgroundColor !== wantBg) th.style.backgroundColor = wantBg;
  // While a visual sort lifts header cells (paint.ts, data-sth-z), the lift owns z-index on both cells;
  // copying the Subject's lifted value would leave ours stuck at 1 after the sort is cleared.
  if (th.hasAttribute('data-sth-z')) return;
  const z = !subjectTh.hasAttribute('data-sth-z') && cs.zIndex && cs.zIndex !== 'auto' ? cs.zIndex : '';
  if (th.style.zIndex !== z) th.style.zIndex = z;
}

/** Cells of a row that Freshservice owns (ours excluded), for index-based column alignment. */
function hostCells(row: Element): Element[] {
  return [...row.children].filter((el) => !el.hasAttribute('data-sth-col'));
}

// Human: Recycled rows keep our Start cell while Ember swaps the ticket. Blank it immediately so the old
// ticket's date is never shown next to the new ticket; the next paint fills the right value.
// Agent: READS rowKey vs td[data-sth-key]. WRITES our td only (the list observer ignores our nodes).
export function invalidateStaleStartCells(doc: Document = document): void {
  doc.querySelectorAll('tbody td[data-sth-col="start"]').forEach((el) => {
    const td = el as HTMLTableCellElement;
    const row = td.closest('tr');
    if (!row || rowKey(row) === (td.dataset.sthKey || '')) return;
    delete td.dataset.sthKey;
    delete td.dataset.startKey;
    if (!td.querySelector('.sth-empty') || td.children.length !== 1) td.innerHTML = '<span class="sth-empty">—</span>';
  });
}

// Human: Journeys only. One header cell after Subject plus one body cell per row, kept in that slot even
// when Freshservice re-renders or reorders columns. Removed entirely when Subject is hidden.
// Agent: WRITES th/td[data-sth-col=start]. Moves only our own nodes. Rows without a subject td are
// aligned by the header's column index so later columns never shift.
export function injectStartColumn(items: RowItem[], doc: Document = document): void {
  if (getModuleId() !== 'journeys') {
    removeStartColumn(doc);
    return;
  }
  const subjectTh = doc.querySelector('thead th[data-name="subject"], thead th[data-name="ticket_subject"]');
  if (!subjectTh) {
    // Subject hidden or header re-rendering: a stale column would misalign every later cell.
    removeStartColumn(doc);
    return;
  }
  let th = doc.querySelector('thead th[data-sth-col="start"]') as HTMLElement | null;
  if (!th) {
    th = doc.createElement('th');
    th.setAttribute('data-sth-col', 'start');
    th.className = 'ember-view ellipsis is-resizable sth-start-header';
    th.setAttribute('role', 'columnheader');
  }
  if (subjectTh.nextElementSibling !== th) subjectTh.after(th);
  syncHeaderChrome(th, subjectTh);
  syncStartColumnHeader(doc);
  const headerRow = subjectTh.parentElement;
  const subjectIndex = headerRow ? hostCells(headerRow).indexOf(subjectTh) : -1;
  const canRange = rangeListingEnabled(hasApiKeyPresent());
  items.forEach((item) => {
    const anchor = item.row.querySelector(':scope > td[data-name="subject"], :scope > td[data-name="ticket_subject"]')
      || (subjectIndex >= 0 ? hostCells(item.row)[subjectIndex] : null);
    if (!anchor) return;
    let td = item.row.querySelector(':scope > td[data-sth-col="start"]') as HTMLTableCellElement | null;
    if (!td) {
      td = doc.createElement('td');
      td.dataset.sthCol = 'start';
      td.className = 'ember-view sth-start-cell';
    }
    if (anchor.nextElementSibling !== td) anchor.after(td);
    const key = item.href || '';
    if (td.dataset.sthKey !== key) td.dataset.sthKey = key;
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
