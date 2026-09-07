// Human: Build Freshservice ticket filter query strings from panel match settings.
// Agent: PURE. Date operator :< is inclusive LTE per FS docs. Unknown status names are dropped. Inverted rules are omitted (FS filter cannot express NOT).

import { MS_DAY } from '../constants';
import { asFiniteNumber, asNumberList, enabledFilters } from '../filters';
import { normalizeRange, shiftDateKey } from '../range';
import type { FilterRule, MatchMode, PageSettings } from '../types';

function utcDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function idleCutoffDate(days: number, now: number = Date.now()): string {
  return utcDateKey(now - days * MS_DAY);
}

export function futureCutoffDate(days: number, now: number = Date.now()): string {
  return utcDateKey(now + days * MS_DAY);
}

function statusClause(statuses: unknown, nameToId: Map<string, number>): string {
  const statusIds = (Array.isArray(statuses) ? statuses : [])
    .map((s) => nameToId.get(String(s).toLowerCase()))
    .filter((id): id is number => id != null);
  return statusIds.map((id) => `status:${id}`).join(' OR ');
}

function combineIdleAndStatus(idle: string | null, statusPart: string, matchMode: MatchMode): string {
  if (idle && statusPart) {
    return matchMode === 'and' ? `(${statusPart}) AND ${idle}` : `${statusPart} OR ${idle}`;
  }
  return idle || statusPart;
}

function combineDims(dims: string[], matchMode: MatchMode): string {
  const parts = dims.filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  if (matchMode === 'and') {
    return parts.map((p) => (/\sOR\s|\sAND\s/.test(p) ? `(${p})` : p)).join(' AND ');
  }
  return parts.map((p) => (/\sAND\s/.test(p) ? `(${p})` : p)).join(' OR ');
}

function dateBand(field: 'updated_at' | 'created_at', minDays: number | null, maxDays: number | null, now: number): string {
  let lo = minDays;
  let hi = maxDays;
  if (lo != null && hi != null && lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  const parts: string[] = [];
  if (lo != null) parts.push(`${field}:<'${idleCutoffDate(lo, now)}'`);
  if (hi != null) parts.push(`${field}:>'${idleCutoffDate(hi, now)}'`);
  return parts.join(' AND ');
}

function dueClause(within: number, now: number): string {
  if (within <= 0) return `due_by:<'${idleCutoffDate(0, now)}'`;
  const end = shiftDateKey(futureCutoffDate(within, now), 1) || futureCutoffDate(within, now);
  return `due_by:<'${end}'`;
}

export function buildRuleTicketQuery(
  rule: FilterRule,
  nameToId: Map<string, number>,
  now: number = Date.now(),
): string {
  if (rule.invert) return '';
  const c = rule.criteria || {};
  const dims: string[] = [];
  const idle = dateBand('updated_at', asFiniteNumber(c.idleDays), asFiniteNumber(c.idleDaysMax), now);
  if (idle) dims.push(idle);
  const created = dateBand('created_at', asFiniteNumber(c.createdDays), asFiniteNumber(c.createdDaysMax), now);
  if (created) dims.push(created);
  const statusPart = statusClause(c.statuses, nameToId);
  if (statusPart) dims.push(statusPart);
  const prios = asNumberList(c.priorities).filter((n) => n >= 1 && n <= 4);
  if (prios.length) dims.push(prios.map((id) => `priority:${id}`).join(' OR '));
  const due = asFiniteNumber(c.dueWithin);
  if (due != null) dims.push(dueClause(due, now));
  if (c.unassigned === true) dims.push('agent_id:null');
  return combineDims(dims, rule.matchMode === 'and' ? 'and' : 'or');
}

export function buildTicketFilterQuery(
  cfg: PageSettings,
  nameToId: Map<string, number>,
  now: number = Date.now(),
): string {
  const enabled = enabledFilters(cfg);
  if (enabled.length) {
    const parts = enabled.map((rule) => buildRuleTicketQuery(rule, nameToId, now)).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    return parts.map((p) => `(${p})`).join(' OR ');
  }
  const idle = `updated_at:<'${idleCutoffDate(cfg.days, now)}'`;
  const statusPart = statusClause(cfg.statuses, nameToId);
  return combineIdleAndStatus(idle, statusPart, cfg.matchMode === 'and' ? 'and' : 'or');
}

// Human: Inclusive calendar from–to on updated_at. `:<` is LTE of that timestamp, so To is bumped one UTC day.
// Agent: PURE. Client-side inDateRange still drops any extra day the API includes.
export function buildUpdatedRangeQuery(from: unknown, to: unknown): string {
  const { startFrom, startTo } = normalizeRange(from, to);
  const parts: string[] = [];
  if (startFrom) parts.push(`updated_at:>'${startFrom}'`);
  if (startTo) {
    const end = shiftDateKey(startTo, 1) || startTo;
    parts.push(`updated_at:<'${end}'`);
  }
  return parts.join(' AND ');
}

export function chunkIds(ids: number[], maxChars: number = 480): number[][] {
  const chunks: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  ids.forEach((id) => {
    const piece = `${cur.length ? ' OR ' : ''}id:${id}`;
    if (len + piece.length > maxChars && cur.length) {
      chunks.push(cur);
      cur = [id];
      len = `id:${id}`.length;
    } else {
      cur.push(id);
      len += piece.length;
    }
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function idsQuery(ids: number[]): string {
  return ids.map((id) => `id:${id}`).join(' OR ');
}
