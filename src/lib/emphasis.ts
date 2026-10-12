// Human: Pick the cell that explains why a row is highlighted (the strong outline), based on the
// criteria of the matching rule that actually passed — not always the Updated date.
// Agent: READS row td[data-name] / td[data-sth-col]. PURE otherwise. RETURNS null when no visible cell
// explains the match (hidden column, API-only data, inverted rule) so the outline never misleads.

import { LIST_COLUMNS } from './columns';
import { rowStatusAge } from './rows';

/** Most telling criterion first: an "Idle" rule that also checks status outlines the date. */
const EMPHASIS_ORDER = [
  'idleDays',
  'createdDays',
  'dueWithin',
  'duePattern',
  'priorities',
  'priorityPattern',
  'escalated',
  'escalatedPattern',
  'unassigned',
  'unassignedPattern',
  'statuses',
  'statusPattern',
  'startDates',
  'startWithin',
  'maxProgress',
  'initiators',
  'kinds',
  'subjectIncludes',
  'subjectPattern',
] as const;

/** Criterion → list column id (LIST_COLUMNS) or a special target. */
const EMPHASIS_TARGET: Record<string, string> = {
  idleDays: 'idle',
  createdDays: 'created',
  dueWithin: 'due',
  duePattern: 'due',
  priorities: 'priority',
  priorityPattern: 'priority',
  escalated: 'escalated',
  escalatedPattern: 'escalated',
  unassigned: 'assigned',
  unassignedPattern: 'assigned',
  statuses: 'status',
  statusPattern: 'status',
  startDates: 'start',
  startWithin: 'start',
  maxProgress: 'progress',
  initiators: 'requester',
  kinds: 'subject',
  subjectIncludes: 'subject',
  subjectPattern: 'subject',
};

function columnCell(row: Element, columnId: string): HTMLElement | null {
  const column = LIST_COLUMNS[columnId];
  if (!column) return null;
  for (let i = 0; i < column.aliases.length; i += 1) {
    const td = row.querySelector(`:scope > td[data-name="${column.aliases[i]}"]`);
    if (td instanceof HTMLElement) return td;
  }
  return null;
}

/** Outline the content inside the td (table cells clip outlines unevenly across engines). */
function innerTarget(td: HTMLElement): HTMLElement {
  const date = td.querySelector('[data-test-id="date-cell"]');
  if (date instanceof HTMLElement) return date;
  const first = td.firstElementChild;
  return first instanceof HTMLElement ? first : td;
}

function resolveTarget(row: Element, target: string, idleCell: Element | null): Element | null {
  if (target === 'idle') return idleCell;
  if (target === 'start') {
    const start = row.querySelector(':scope > td[data-sth-col="start"]');
    if (start instanceof HTMLElement) return innerTarget(start);
    const subject = columnCell(row, 'subject');
    return subject ? innerTarget(subject) : null;
  }
  if (target === 'progress') {
    const counts = row.querySelector('.progress-counts');
    const td = counts?.closest('td') || row.querySelector(':scope > td[data-name="child_ticket_progress"]');
    return td instanceof HTMLElement ? innerTarget(td) : null;
  }
  const td = columnCell(row, target);
  return td ? innerTarget(td) : null;
}

/**
 * Cell to outline for a highlighted row.
 * `passing` comes from passingCriteria(); `idleCell` is the scraped Updated/Created date element.
 */
export function emphasisCell(row: Element, passing: readonly string[], idleCell: Element | null): Element | null {
  if (!passing.length) return null;
  for (let i = 0; i < EMPHASIS_ORDER.length; i += 1) {
    const id = EMPHASIS_ORDER[i];
    if (!passing.includes(id)) continue;
    const found = resolveTarget(row, EMPHASIS_TARGET[id], idleCell);
    if (found && row.contains(found)) return found;
  }
  return null;
}

// Human: Where a row's idle days came from. Without API data, "Open since N days" on the status control wins
// over the Updated date (collectRows), so an idle rule is explained by the Status cell in that case.
// Agent: READS the status trigger aria-label via rowStatusAge. RETURNS the element to outline for idleDays.
export function idleExplainingCell(row: Element, _fromApi: boolean, dateCell: Element | null): Element | null {
  // Human: Status age stays the idle value even after an API enrich, so the outline stays on Status.
  if (rowStatusAge(row) != null) {
    const status = columnCell(row, 'status');
    if (status) return innerTarget(status);
  }
  return dateCell;
}
