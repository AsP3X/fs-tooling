// Human: Scrape Freshservice Ember table rows (tr.et-tr) into RowItem records.
// Agent: READS document DOM. Idle days prefer "since N days" on the status trigger, else Updated, else Created.

import { parseRecordRef } from './api/ids';
import { MS_DAY } from './constants';
import { ageDays, dateKey, daysUntil, parseStartDate, parseTicketDate } from './dates';
import { agentCellUnassigned, parsePriority } from './ticket-fields';
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

function cleanStatus(raw: string | null | undefined): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

/** Badge title first, then the status cell text, then "Open since N days" on the trigger. */
export function rowStatus(row: Element): string {
  const badge = row.querySelector('[data-test-id="state-cell"] span, .status-result, td[data-name="status"] [title], td[data-name="ticket_status"] [title]');
  const fromBadge = cleanStatus(badge?.getAttribute('title') || badge?.textContent);
  if (fromBadge) return fromBadge;
  const cell = row.querySelector('td[data-name="status"], td[data-name="ticket_status"]');
  const fromCell = cleanStatus(cell?.getAttribute('title') || cell?.textContent);
  if (fromCell) return fromCell;
  const trigger = row.querySelector('.status-list-trigger, [data-ebd-id$="-trigger"]');
  const label = trigger?.getAttribute('aria-label') || '';
  const since = label.match(/^(.*?)\s+since\s+\d+\s+days?/i);
  if (since?.[1]) return cleanStatus(since[1]);
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

/** First matching td[data-name] so extra ticket columns stay optional. */
function namedCell(row: Element, names: string[]): HTMLElement | null {
  for (let i = 0; i < names.length; i += 1) {
    const el = row.querySelector(`td[data-name="${names[i]}"]`);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

function cellDate(cell: Element | null): Date | null {
  if (!cell) return null;
  const titled = cell.querySelector('[data-test-id="date-cell"][title], [title]');
  return parseTicketDate(titled?.getAttribute('title') || cell.getAttribute('title') || cell.textContent);
}

/** First parseable token wins so a class like col-1 cannot override title="Urgent". */
function firstPriority(values: Array<string | null | undefined>): number | null {
  for (let i = 0; i < values.length; i += 1) {
    const n = parsePriority(values[i]);
    if (n != null) return n;
  }
  return null;
}

export function rowPriority(row: Element): number | null {
  const cell = namedCell(row, ['priority', 'ticket_priority', 'priority_name']);
  if (!cell) return null;
  const nested: string[] = [];
  cell.querySelectorAll('[title], [aria-label], [alt], [data-value], [data-priority]').forEach((el) => {
    nested.push(
      el.getAttribute('data-value') || '',
      el.getAttribute('data-priority') || '',
      el.getAttribute('title') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('alt') || '',
      el.getAttribute('class') || '',
    );
  });
  return firstPriority([
    cell.getAttribute('data-value'),
    cell.getAttribute('data-priority'),
    cell.getAttribute('title'),
    cell.getAttribute('aria-label'),
    ...nested,
    cell.getAttribute('class'),
    cell.textContent,
  ]);
}

export function rowDueDate(row: Element): Date | null {
  return cellDate(namedCell(row, ['due_by', 'due_by_date', 'due_date', 'fr_due_by']));
}

export function rowUnassigned(row: Element): boolean | null {
  const cell = namedCell(row, ['responder', 'agent', 'assigned_to', 'responder_name', 'agent_name']);
  if (!cell) return null;
  const name = String(cell.querySelector('a, .requester-cell-name')?.textContent || cell.textContent || '');
  return agentCellUnassigned(name, true);
}

export function rowEscalated(row: Element): boolean | null {
  const cell = namedCell(row, ['is_escalated', 'fr_escalated', 'sla_timer', 'sla_status']);
  if (!cell) return null;
  const text = `${cell.getAttribute('title') || ''} ${cell.textContent || ''}`;
  if (/escalat/i.test(text)) return true;
  const raw = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (raw === 'yes' || raw === 'true') return true;
  if (raw === 'no' || raw === 'false' || raw === '—' || raw === '-') return false;
  return false;
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
    const href = ticketHref(row);
    const due = rowDueDate(row);
    out.push({
      row,
      cell: updatedEl || createdEl,
      href,
      status: rowStatus(row) || '—',
      idleDays,
      created,
      updated,
      start,
      startIn,
      kind: employeeKind(title),
      progress,
      startKey: dateKey(start),
      updatedKey: dateKey(updated),
      initiator: initiatorName(row),
      ord: Number(row.dataset.sthOrd || idx),
      label: sanitizeTitle(title),
      recordId: parseRecordRef(href)?.id ?? null,
      fromApi: false,
      subject: title,
      createdDays: ageDays(created, now),
      dueIn: daysUntil(due, now),
      priority: rowPriority(row),
      unassigned: rowUnassigned(row),
      escalated: rowEscalated(row),
    });
  });
  return out;
}
