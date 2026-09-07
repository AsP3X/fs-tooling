// Human: Build Freshservice ticket filter query strings from panel match settings.
// Agent: PURE. Date operator :< is inclusive LTE per FS docs. Unknown status names are dropped.

import { MS_DAY } from '../constants';
import { enabledFilters } from '../filters';
import { normalizeRange, shiftDateKey } from '../range';
import type { FilterRule, MatchMode, PageSettings } from '../types';

export function idleCutoffDate(days: number, now: number = Date.now()): string {
  const d = new Date(now - days * MS_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

export function buildRuleTicketQuery(
  rule: FilterRule,
  nameToId: Map<string, number>,
  now: number = Date.now(),
): string {
  const days = typeof rule.criteria.idleDays === 'number' ? rule.criteria.idleDays : null;
  const idle = days != null ? `updated_at:<'${idleCutoffDate(days, now)}'` : null;
  const statusPart = statusClause(rule.criteria.statuses, nameToId);
  return combineIdleAndStatus(idle, statusPart, rule.matchMode === 'and' ? 'and' : 'or');
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
