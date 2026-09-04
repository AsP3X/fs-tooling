// Human: Scrape Freshservice Ember table rows (tr.et-tr) into RowItem records.
// Agent: READS document DOM. Idle days prefer "since N days" on the status trigger, else Updated, else Created.

import { MS_DAY } from './constants';
import { parseStartDate, parseTicketDate, dateKey } from './dates';
import { employeeKind, sanitizeTitle } from './text';
import type { Progress, RowItem } from './types';

export function cellText(row: Element, sel: string): string {
  const el = row.querySelector(sel);
  return String(el?.getAttribute('title') || el?.textContent || '').replace(/\s+/g, ' ').trim();
}

export function rowTitle(row: Element): string {
  const titled = row.querySelector(
    'td[data-name="subject"] [title], td[data-name="ticket_subject"] [title], a.subject-cell [title], a[href] [title]',
  );
  const attr = titled?.getAttribute('title') || '';
  const text = cellText(row, 'td[data-name="subject"]') || cellText(row, 'a.subject-cell') || cellText(row, 'td[data-name="ticket_subject"]');
  if (parseStartDate(attr)) return attr;
  if (parseStartDate(text)) return text;
  return attr || text;
}

export function ticketHref(row: Element, origin: string = location.origin): string | null {
  const a = row.querySelector('a.subject-cell[href], a[href*="/tickets/"], a[href*="/employee_onboarding/"]');
  if (!a) return null;
  try {
    return new URL(a.getAttribute('href') || '', origin).href;
  } catch {
    return null;
  }
}

export function rowStatus(row: Element): string {
  const badge = row.querySelector('[data-test-id="state-cell"] span, .status-result, td[data-name="status"] [title]');
  if (badge) return String(badge.getAttribute('title') || badge.textContent || '').replace(/\s+/g, ' ').trim();
  return '';
}

export function rowStatusAge(row: Element): number | null {
  const trigger = row.querySelector('.status-list-trigger, [data-ebd-id$="-trigger"]');
  const label = trigger?.getAttribute('aria-label') || '';
  const m = label.match(/since\s+(\d+)\s+days?/i);
  return m ? Number(m[1]) : null;
}

export function rowProgress(row: Element): Progress {
  const raw = row.querySelector('.progress-counts')?.textContent || '';
  const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { done: null, total: null, pct: null };
  const done = +m[1];
  const total = +m[2];
  return { done, total, pct: total ? (done / total) * 100 : null };
}

export function initiatorName(row: Element): string {
  const el = row.querySelector('.requester-cell-name, td[data-name="initiator"] a, td[data-name="initiator"]');
  return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
}

export function rowTbody(row: Element): HTMLTableSectionElement | null {
  return row.closest('tbody');
}

export function collectRows(doc: Document = document, now: number = Date.now()): RowItem[] {
  const out: RowItem[] = [];
  doc.querySelectorAll('tr.et-tr').forEach((row, idx) => {
    if (!(row instanceof HTMLTableRowElement)) return;
    if (row.closest('thead')) return;
    if (!row.dataset.sthOrd) row.dataset.sthOrd = String(idx);
    const updatedEl = row.querySelector('td[data-name="updated_at_date"] [data-test-id="date-cell"]');
    const createdEl = row.querySelector(
      'td[data-name="created_at_date"] [data-test-id="date-cell"], td[data-name="created_at"] [data-test-id="date-cell"]',
    );
    const title = rowTitle(row);
    const updated = parseTicketDate(updatedEl?.getAttribute('title') || updatedEl?.textContent);
    const created = parseTicketDate(createdEl?.getAttribute('title') || createdEl?.textContent);
    const statusAge = rowStatusAge(row);
    const start = parseStartDate(title);
    const progress = rowProgress(row);
    const idleDays = statusAge != null
      ? statusAge
      : updated
        ? (now - updated.getTime()) / MS_DAY
        : created
          ? (now - created.getTime()) / MS_DAY
          : null;
    const startIn = start ? (start.getTime() - now) / MS_DAY : null;
    out.push({
      row,
      cell: updatedEl || createdEl,
      href: ticketHref(row),
      status: rowStatus(row) || '—',
      idleDays,
      created,
      updated,
      start,
      startIn,
      kind: employeeKind(title),
      progress,
      startKey: dateKey(start),
      initiator: initiatorName(row),
      ord: Number(row.dataset.sthOrd || idx),
      label: sanitizeTitle(title),
    });
  });
  return out;
}
