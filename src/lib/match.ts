// Human: AND/OR matching for idle age, status tags, start dates, progress, and start-within.
// Agent: PURE. Empty status/start tags are ignored in AND mode (do not require a match). Date range is not part of highlight matching.

import type { Matchable, PageSettings } from './types';

export function statusWanted(item: Matchable, cfg: PageSettings): boolean {
  const tags = (cfg.statuses || []).map((s) => s.toLowerCase());
  if (!tags.length) return false;
  return tags.includes(String(item.status).toLowerCase());
}

export function startWanted(item: Matchable, cfg: PageSettings): boolean {
  const tags = cfg.startDates || [];
  if (!tags.length) return false;
  return !!(item.startKey && tags.includes(item.startKey));
}

export function itemMatches(item: Matchable, cfg: PageSettings): boolean {
  const stale = item.idleDays != null && item.idleDays >= cfg.days;
  const byStatus = statusWanted(item, cfg);
  const byStart = startWanted(item, cfg);
  const andMode = cfg.matchMode === 'and';
  let match = andMode
    ? (stale && (!cfg.statuses.length || byStatus) && (!cfg.startDates.length || byStart))
    : (stale || byStatus || byStart);
  if (cfg.maxProgress != null && item.progress.pct != null) {
    const low = item.progress.pct <= cfg.maxProgress;
    match = andMode ? (match && low) : (match || low);
  }
  if (cfg.startWithin != null && item.startIn != null) {
    const soon = item.startIn <= cfg.startWithin;
    match = andMode ? (match && soon) : (match || soon);
  }
  return match;
}
