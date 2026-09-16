// Human: Freshservice list columns are reorderable and hideable. Filters key off data-name, not visual order.
// Agent: PURE except visibleColumnNames READS thead/td[data-name]. missingColumnsForRule skips checks when apiAvailable.

import type { FilterCriteria, FilterRule } from './types';

export interface ListColumn {
  id: string;
  label: string;
  aliases: string[];
}

/** Canonical list columns. Aliases match td/th data-name values Freshservice uses. */
export const LIST_COLUMNS: Record<string, ListColumn> = {
  subject: { id: 'subject', label: 'Subject', aliases: ['ticket_subject', 'subject'] },
  requester: { id: 'requester', label: 'Requester', aliases: ['requester', 'initiator'] },
  updated: { id: 'updated', label: 'Updated', aliases: ['updated_at_date', 'updated_at'] },
  created: { id: 'created', label: 'Created', aliases: ['created_at_date', 'created_at'] },
  status: { id: 'status', label: 'Status', aliases: ['status', 'ticket_status'] },
  assigned: {
    id: 'assigned',
    label: 'Agent',
    aliases: ['assigned_to', 'responder', 'agent', 'responder_name', 'agent_name'],
  },
  priority: { id: 'priority', label: 'Priority', aliases: ['priority', 'ticket_priority', 'priority_name'] },
  due: { id: 'due', label: 'Due date', aliases: ['due_by', 'due_by_date', 'due_date', 'fr_due_by'] },
  escalated: {
    id: 'escalated',
    label: 'SLA / Escalated',
    aliases: ['is_escalated', 'fr_escalated', 'sla_timer', 'sla_status'],
  },
};

/** Criterion id → columns that must be on the list (or filled by the API). */
export const CRITERION_COLUMNS: Record<string, string[]> = {
  idleDays: ['updated'],
  createdDays: ['created'],
  statuses: ['status'],
  statusPattern: ['status'],
  excludeStatuses: ['status'],
  initiators: ['requester'],
  unassigned: ['assigned'],
  unassignedPattern: ['assigned'],
  priorities: ['priority'],
  priorityPattern: ['priority'],
  dueWithin: ['due'],
  duePattern: ['due'],
  escalated: ['escalated'],
  escalatedPattern: ['escalated'],
  subjectIncludes: ['subject'],
  subjectPattern: ['subject'],
  startDates: ['subject'],
  startWithin: ['subject'],
  kinds: ['subject'],
};

export function visibleColumnNames(doc: Document = document): Set<string> {
  const names = new Set<string>();
  const listTable = doc.querySelector('table:has(tr.et-tr)')
    || doc.querySelector('table:has(th[data-name="ticket_subject"], th[data-name="subject"])');
  const root: ParentNode = listTable || doc;
  root.querySelectorAll('th[data-name], td[data-name]').forEach((el) => {
    const name = el.getAttribute('data-name');
    if (name) names.add(name);
  });
  return names;
}

export function columnIsVisible(column: ListColumn, visible: Set<string>): boolean {
  return column.aliases.some((alias) => visible.has(alias));
}

function hasNum(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasText(value: unknown): boolean {
  return String(value || '').trim().length > 0;
}

/** Same on/off rules as criterionActive, kept here so columns.ts does not import filters.ts. */
export function activeCriterionIds(criteria: FilterCriteria): string[] {
  const c = criteria || {};
  const ids: string[] = [];
  if (hasNum(c.idleDays) || hasNum(c.idleDaysMax)) ids.push('idleDays');
  if (hasNum(c.createdDays) || hasNum(c.createdDaysMax)) ids.push('createdDays');
  if (hasList(c.statuses)) ids.push('statuses');
  if (hasText(c.statusPattern)) ids.push('statusPattern');
  if (hasList(c.excludeStatuses)) ids.push('excludeStatuses');
  if (hasList(c.initiators)) ids.push('initiators');
  if (c.unassigned === true) ids.push('unassigned');
  if (hasText(c.unassignedPattern)) ids.push('unassignedPattern');
  if (hasList(c.priorities)) ids.push('priorities');
  if (hasText(c.priorityPattern)) ids.push('priorityPattern');
  if (hasNum(c.dueWithin)) ids.push('dueWithin');
  if (hasText(c.duePattern)) ids.push('duePattern');
  if (c.escalated === true) ids.push('escalated');
  if (hasText(c.escalatedPattern)) ids.push('escalatedPattern');
  if (hasList(c.subjectIncludes)) ids.push('subjectIncludes');
  if (hasText(c.subjectPattern)) ids.push('subjectPattern');
  if (hasList(c.startDates)) ids.push('startDates');
  if (c.startPassed === true || hasNum(c.startWithin)) ids.push('startWithin');
  if (hasList(c.kinds)) ids.push('kinds');
  return ids;
}

/**
 * Columns an enabled rule needs that are not on the current list.
 * API enrich covers the same fields, so a saved key suppresses the warning.
 */
export function missingColumnsForRule(
  rule: FilterRule,
  visible: Set<string>,
  apiAvailable: boolean,
): ListColumn[] {
  if (!rule.enabled) return [];
  if (apiAvailable) return [];
  const seen = new Set<string>();
  const missing: ListColumn[] = [];
  activeCriterionIds(rule.criteria || {}).forEach((criterionId) => {
    (CRITERION_COLUMNS[criterionId] || []).forEach((colId) => {
      if (seen.has(colId)) return;
      seen.add(colId);
      const col = LIST_COLUMNS[colId];
      if (col && !columnIsVisible(col, visible)) missing.push(col);
    });
  });
  return missing;
}

export function missingColumnsMessage(missing: ListColumn[]): string {
  if (!missing.length) return '';
  const names = missing.map((c) => c.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const plural = names.length > 1;
  return `This filter needs the ${list} column${plural ? 's' : ''}, which ${plural ? 'are' : 'is'} hidden. Add ${plural ? 'them' : 'it'} under Customize columns, or save an API key.`;
}
