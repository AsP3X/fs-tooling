// Human: Scrape Freshservice Ember table rows (tr.et-tr) into RowItem records.
// Agent: READS document DOM. Idle days prefer "since N days" on the status trigger, else Updated, else Created.

import { parseRecordRef } from './api/ids';
import { LIST_COLUMNS } from './columns';
import { MS_DAY } from './constants';
import { ageDays, dateKey, daysUntil, parseStartDate, parseTicketDate } from './dates';
import { DEFAULT_PATTERNS, parseStatusAgeLabel, patternMatches } from './patterns';
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
  const aged = parseStatusAgeLabel(trigger?.getAttribute('aria-label') || '');
  if (aged?.status) return cleanStatus(aged.status);
  return '';
}

export function rowStatusAge(row: Element): number | null {
  const trigger = row.querySelector('.status-list-trigger, [data-ebd-id$="-trigger"]');
  const aged = parseStatusAgeLabel(trigger?.getAttribute('aria-label') || '');
  return aged ? aged.days : null;
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
function namedCell(row: Element, names: readonly string[]): HTMLElement | null {
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

/** Visible labels/titles on a cell. Skips class names so CSS tokens are not identification text. */
// Agent: READS attributes + textContent. RETURNS null when the column is missing or empty.
function cellHaystack(cell: Element | null): string | null {
  if (!cell) return null;
  const bits: string[] = [
    cell.getAttribute('data-value') || '',
    cell.getAttribute('data-priority') || '',
    cell.getAttribute('title') || '',
    cell.getAttribute('aria-label') || '',
    cell.textContent || '',
  ];
  cell.querySelectorAll('[title], [aria-label], [alt], [data-value], [data-priority]').forEach((el) => {
    bits.push(
      el.getAttribute('data-value') || '',
      el.getAttribute('data-priority') || '',
      el.getAttribute('title') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('alt') || '',
    );
  });
  const text = bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return text || null;
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
  const cell = namedCell(row, LIST_COLUMNS.priority.aliases);
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
  return cellDate(namedCell(row, LIST_COLUMNS.due.aliases));
}

/** Scraped Priority cell labels for identification regex. Null when the column is missing. */
export function rowPriorityText(row: Element): string | null {
  return cellHaystack(namedCell(row, LIST_COLUMNS.priority.aliases));
}

/** Scraped Agent cell text for unassigned regex. Null when the column is missing or empty. */
export function rowAgentText(row: Element): string | null {
  const cell = namedCell(row, LIST_COLUMNS.assigned.aliases);
  if (!cell) return null;
  const name = String(cell.querySelector('a, .requester-cell-name')?.textContent || cell.textContent || '').replace(/\s+/g, ' ').trim();
  return name || null;
}

export function rowUnassigned(row: Element): boolean | null {
  const cell = namedCell(row, LIST_COLUMNS.assigned.aliases);
  if (!cell) return null;
  const name = String(cell.querySelector('a, .requester-cell-name')?.textContent || cell.textContent || '');
  return agentCellUnassigned(name, true);
}

/** Scraped SLA / Escalated cell text for identification regex. */
export function rowEscalatedText(row: Element): string | null {
  return cellHaystack(namedCell(row, LIST_COLUMNS.escalated.aliases));
}

export function rowEscalated(row: Element): boolean | null {
  const cell = namedCell(row, LIST_COLUMNS.escalated.aliases);
  if (!cell) return null;
  const text = `${cell.getAttribute('title') || ''} ${cell.textContent || ''}`;
  if (patternMatches(DEFAULT_PATTERNS.escalated, text) === true) return true;
  const raw = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (raw === 'yes' || raw === 'true' || raw === 'ja') return true;
  if (raw === 'no' || raw === 'false' || raw === 'nein' || raw === '—' || raw === '-') return false;
  return false;
}

/** Scraped Due date cell text for overdue identification regex. */
export function rowDueText(row: Element): string | null {
  return cellHaystack(namedCell(row, LIST_COLUMNS.due.aliases));
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
      priorityText: rowPriorityText(row),
      agentText: rowAgentText(row),
      escalatedText: rowEscalatedText(row),
      dueText: rowDueText(row),
    });
  });
  return out;
}
